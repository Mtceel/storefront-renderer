# Storefront Renderer

Dynamic customer-facing storefronts with subdomain routing.

## Features

- ✅ Subdomain-based routing (shop1.fv-company.com)
- ✅ Dynamic theme rendering
- ✅ Shopping cart
- ✅ Checkout flow
- ✅ Horizontal scaling

## Deploy to dedicated server

```bash
# Server 3 - Storefront only
git clone https://github.com/MTceel/storefront-renderer.git
cd storefront-renderer
kubectl apply -f k8s/

# Scale based on traffic
kubectl scale deployment storefront --replicas=20
```
