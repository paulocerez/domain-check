# Domain Check

Simple tool to check your domains from GoDaddy, IONOS, etc. to manage duration and costs.

## Supported Domains

<div align="center">
  <img src="client/public/godaddy_logo.png" alt="GoDaddy" width="247" />
  <img src="client/public/ionos_logo.png" alt="IONOS" width="200" />
</div>

## Project Structure

```
├── server/          # Express backend API
│   ├── src/
│   │   ├── controllers/  # Request handlers
│   │   ├── services/     # Business logic & API integrations
│   │   ├── routes/       # API route definitions
│   │   ├── types/        # TypeScript interfaces∏
│   │   ├── middleware/   # Express middleware
│   │   └── index.ts      # Server entry point
│   └── package.json      # Backend dependencies
└── package.json     # Root workspace configuration
```

### API Endpoints

#### Domain Health Check
```bash
GET /api/domains/health
```

#### Check Single Domain
```bash
POST /api/domains/check
Content-Type: application/json

{
  "domain": "example.com",
  "registrar": "godaddy",
  "credentials": {
    "apiKey": "your-api-key",
    "apiSecret": "your-api-secret"
  }
}
```

#### Check Multiple Domains
```bash
POST /api/domains/check-multiple
Content-Type: application/json

{
  "domains": [
    {
      "domain": "example.com",
      "registrar": "godaddy"
    },
    {
      "domain": "example2.com",
      "registrar": "ionos"
    }
  ],
  "credentials": {
    "apiKey": "your-api-key",
    "apiSecret": "your-api-secret"
  }
}
```

### Response Format

```json
{
  "success": true,
  "data": {
    "domain": "example.com",
    "registrar": "godaddy",
    "expirationDate": "2024-12-31",
    "creationDate": "2020-01-01",
    "renewalPrice": 12.99,
    "currency": "USD",
    "status": "active",
    "daysUntilExpiration": 365
  },
  "registrar": "godaddy"
}
```
