const params = new URLSearchParams(window.location.search);
const productId = params.get("id");
const productDetails = document.getElementById("productDetails");
let currentProduct = null;

async function loadProduct() {
    if (!productId) {
        productDetails.innerHTML = "<p>المنتج غير موجود.</p>";
        return;
    }
    try {
        const result = await apiFetch(`/api/products/${encodeURIComponent(productId)}`);
        const product = result.product;
        if (!product) {
            productDetails.innerHTML = "<p>المنتج غير موجود.</p>";
            return;
        }
        currentProduct = product;
        productDetails.innerHTML = `
            <div class="product-details">
                <div class="product-details-image">
                    <img src="${product.image || 'images/default-product.jpg'}" alt="${product.name}">
                </div>
                <div class="product-details-info">
                    <h1>${product.name}</h1>
                    <span class="product-category">${product.category || ""}</span>
                    <div class="product-price">${product.price} جنيه</div>
                    <p class="product-description">${product.description || "لا يوجد وصف لهذا المنتج"}</p>
                    <button class="add-to-cart-btn" id="addCurrentProductBtn" type="button">
                        <i class="fa-solid fa-cart-shopping"></i> أضف إلى السلة
                    </button>
                </div>
            </div>`;
    } catch (error) {
        console.error(error);
        productDetails.innerHTML = "<p>حدث خطأ أثناء تحميل المنتج.</p>";
    }
}

function addCurrentProductToCart() {
    if (!currentProduct) return;
    addToCart({
        id: currentProduct.id,
        name: currentProduct.name,
        price: currentProduct.price,
        image: currentProduct.image,
        stock: Number(currentProduct.stock ?? 999999),
        options: currentProduct.options || {}
    });
}

// Bind the add-to-cart button after the product HTML is rendered.
document.addEventListener('click', function(e) {
    const btn = e.target.closest('#addCurrentProductBtn');
    if (!btn) return;
    addCurrentProductToCart();
});

loadProduct();
