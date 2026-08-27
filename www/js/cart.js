let cart = JSON.parse(localStorage.getItem('cart') || '[]');
let shippingRates = {};
let appliedCoupon = null;

function saveCart(){ localStorage.setItem('cart', JSON.stringify(cart)); }
function updateCartCount(){ const el=document.getElementById('cartCount'); if(el) el.textContent=cart.reduce((s,p)=>s+Number(p.quantity||0),0); }
function money(v){ return `${Number(v||0).toFixed(0)} جنيه`; }
function subtotal(){ return cart.reduce((s,p)=>s+Number(p.price)*Number(p.quantity),0); }

function addToCart(product){
  if(Number(product.stock ?? 999999) <= 0){ alert('المنتج غير متوفر حاليًا'); return; }
  const existing=cart.find(i=>String(i.id)===String(product.id));
  if(existing){ if(existing.quantity >= Number(product.stock)) { alert('وصلت للكمية المتاحة من هذا المنتج'); return; } existing.quantity++; }
  else cart.push({id:product.id,name:product.name,price:Number(product.price),image:product.image||'',stock:Number(product.stock ?? 999999),quantity:1,options:product.options||{}});
  saveCart(); updateCartCount(); displayCart();
  const toast=document.getElementById('cartToast'); if(toast){toast.classList.add('show');setTimeout(()=>toast.classList.remove('show'),1800);} else alert('تمت إضافة المنتج إلى السلة 🛒');
}

function changeQuantity(id,change){ const p=cart.find(i=>String(i.id)===String(id)); if(!p)return; const next=p.quantity+change; if(next<=0) return removeFromCart(id); if(next>Number(p.stock||999999)){alert('الكمية المطلوبة أكبر من المخزون المتاح');return;} p.quantity=next; saveCart(); displayCart(); }
function removeFromCart(id){ cart=cart.filter(i=>String(i.id)!==String(id)); saveCart(); displayCart(); }

async function loadShippingRates(){
  try{ const r=await apiFetch('/api/shipping/rates'); shippingRates={}; (r.rates||[]).forEach(x=>shippingRates[x.governorate]=Number(x.fee)); const select=document.getElementById('governorate'); if(select){ select.innerHTML='<option value="">اختر المحافظة</option>'+(r.rates||[]).map(x=>`<option value="${x.governorate}">${x.governorate} — ${money(x.fee)}</option>`).join(''); } updateSummary(); }catch(e){console.error(e);}
}
function shippingFee(){ const g=document.getElementById('governorate')?.value; return g && shippingRates[g] != null ? shippingRates[g] : 0; }
async function applyCoupon(){
  const input=document.getElementById('couponCode'), msg=document.getElementById('couponMessage');
  const code=input?.value.trim(); if(!code){appliedCoupon=null;updateSummary();return;}
  try{ const r=await apiFetch('/api/coupons/validate',{method:'POST',body:JSON.stringify({code,subtotal:subtotal()})}); appliedCoupon={code:r.code,discount:Number(r.discount)}; if(msg){msg.textContent=`تم تطبيق الكود: خصم ${money(r.discount)}`;msg.className='coupon-message success';} updateSummary(); }
  catch(e){appliedCoupon=null;if(msg){msg.textContent=e.message;msg.className='coupon-message error';}updateSummary();}
}
function updateSummary(){
  const sub=subtotal(), ship=shippingFee(), discount=appliedCoupon?.discount||0, total=Math.max(0,sub+ship-discount);
  const set=(id,val)=>{const e=document.getElementById(id);if(e)e.textContent=money(val)};
  set('cartSubtotal',sub); set('shippingFee',ship); set('discountAmount',discount); set('cartTotal',total);
  const shippingNote=document.getElementById('shippingNote'); if(shippingNote) shippingNote.textContent=ship?`مصاريف الشحن: ${money(ship)}`:'اختر المحافظة لحساب الشحن';
}

function displayCart(){
  const container=document.getElementById('cartItems'); if(!container)return; container.innerHTML='';
  if(!cart.length){ container.innerHTML='<div class="empty-cart"><i class="fa-solid fa-cart-shopping"></i><p>السلة فارغة حاليًا</p><a href="products.html">تصفح المنتجات</a></div>'; updateSummary(); updateCartCount(); return; }
  cart.forEach(p=>{ const total=Number(p.price)*Number(p.quantity); container.innerHTML+=`<div class="cart-item"><div class="cart-item-image"><img src="${p.image||'images/default-product.jpg'}" alt="${p.name}" loading="lazy"></div><div class="cart-item-info"><h3>${p.name}</h3><p>${money(p.price)} للقطعة</p><div class="quantity-controls"><button onclick="changeQuantity('${p.id}',-1)">−</button><span>${p.quantity}</span><button onclick="changeQuantity('${p.id}',1)">+</button></div><p class="product-total">${money(total)}</p><button class="remove-cart-btn" onclick="removeFromCart('${p.id}')"><i class="fa-solid fa-trash"></i> حذف</button></div></div>`; });
  updateSummary(); updateCartCount();
}

async function checkoutOrder(){
  if(!cart.length){alert('السلة فارغة حاليًا');return;}
  const customer_name=document.getElementById('customerName')?.value.trim(), customer_phone=document.getElementById('customerPhone')?.value.trim(), governorate=document.getElementById('governorate')?.value, area=document.getElementById('area')?.value.trim(), customer_address=document.getElementById('customerAddress')?.value.trim(), payment_method=document.querySelector('input[name="paymentMethod"]:checked')?.value||'cod';
  if(!customer_name||!customer_phone||!governorate||!area||!customer_address){alert('من فضلك أكمل بيانات التوصيل');return;}
  if(payment_method==='card'){alert('الدفع بالكارت سيتم تفعيله قريبًا. اختر الدفع عند الاستلام حاليًا.');return;}
  const btn=document.getElementById('checkoutBtn'); if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> جاري تأكيد الطلب...';}
  try{
    const result=await apiFetch('/api/orders',{method:'POST',body:JSON.stringify({customer_name,customer_phone,governorate,area,customer_address,payment_method,coupon_code:appliedCoupon?.code||'',items:cart.map(p=>({product_id:Number(p.id),quantity:Number(p.quantity),options:p.options||{}}))})});
    const order=result.order; cart=[]; appliedCoupon=null; saveCart(); updateCartCount(); window.location.href=`order-success.html?id=${encodeURIComponent(order.id)}`;
  }catch(e){alert(e.message||'حدث خطأ أثناء تسجيل الطلب');if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-check"></i> تأكيد الطلب';}}
}

document.addEventListener('DOMContentLoaded',()=>{loadShippingRates();displayCart();document.getElementById('governorate')?.addEventListener('change',updateSummary);document.getElementById('applyCoupon')?.addEventListener('click',applyCoupon);document.getElementById('checkoutBtn')?.addEventListener('click',checkoutOrder);});
updateCartCount();
