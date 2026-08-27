const bcrypt = require('bcryptjs');
const password = process.argv[2];
if (!password) {
  console.error('Usage: npm run admin:hash -- "YourStrongPassword"');
  process.exit(1);
}
console.log(bcrypt.hashSync(password, 12));
