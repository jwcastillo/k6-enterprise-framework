# List
curl -s 'https://api.example.com/v1/products?page=1' --compressed
# Login
curl -X POST https://api.example.com/v1/login \
  -H "Content-Type: application/json" \
  -d '{"user": "demo", "password": "literal-secret-123"}'
curl https://api.example.com/v1/cart -H 'Authorization: Bearer eyJliteral.token.value'
