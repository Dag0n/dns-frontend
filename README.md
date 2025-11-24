# DNS Manager

A modern web-based DNS management interface for PowerDNS to manage DNS zones and delegations.

## Features

- **User Authentication**: Secure JWT-based authentication system
- **Zone Management**: View and manage DNS zones assigned to your account
- **Record Management**: Add, edit, and delete DNS records (A, CNAME, MX, TXT, NS)
- **Subdomain Delegation**: Configure NS records for subdomain delegation
- **Access Request System**: Users can request access to new subdomains
- **Admin Panel**: Administrators can approve/deny access requests and manage zones
- **Modern Dashboard**: Professional admin interface with stats and visual indicators

## Technology Stack

### Frontend
- **React 19.2.0**: Modern UI library
- **Vite**: Fast build tool and development server
- **CSS Custom Properties**: Design system with theming support

### Backend
- **Express.js**: Web application framework
- **better-sqlite3**: SQLite database for user management
- **PowerDNS API**: DNS zone and record management
- **JWT**: Secure token-based authentication
- **bcrypt**: Password hashing

## Prerequisites

- Node.js 18+ and npm
- PowerDNS server with API enabled
- SQLite3

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd dns-frontend
```

2. Install dependencies:
```bash
npm install
```

3. Configure backend (serverapp.js):
```javascript
const PDNS_API_URL = "http://your-pdns-server:8081/api/v1";
const PDNS_API_KEY = "your-api-key";
const PDNS_API_SERVER_ID = "localhost";
const BASE_DOMAIN = "your-domain.dev.";
const JWT_SECRET = "your-secure-jwt-secret";
```

4. Start the backend server:
```bash
node serverapp.js
```

5. Start the frontend development server:
```bash
npm run dev
```

6. Open your browser to `http://localhost:5173`

## DNS Configuration

The system uses the following nameservers:
- Primary: `ns1.rubbish.dev.`
- Secondary: `ns2.rubbish.dev.`

SOA records are automatically configured with:
- Primary nameserver: `ns1.rubbish.dev.`
- Hostmaster email: `hostmaster.rubbish.dev.`
- SOA edit API: `INCEPTION-INCREMENT` (automatic serial updates)

## User Roles

### Regular Users
- View assigned DNS zones
- Manage DNS records within their zones
- Configure subdomain delegation
- Request access to new subdomains

### Administrators
- All regular user permissions
- Approve/deny subdomain access requests
- Manage all zones in the system
- View admin panel and request history

## API Endpoints

### Authentication
- `POST /auth/register` - Register new user
- `POST /auth/login` - User login

### Zones
- `GET /zones` - List user's zones
- `GET /zones/:name/records` - Get zone records
- `POST /zones/:name/records` - Add record
- `DELETE /zones/:name/records` - Delete record
- `POST /zones/:name/delegate` - Configure delegation

### Admin
- `GET /admin/zones` - List all zones
- `POST /admin/zones` - Create new zone
- `GET /admin/requests` - View all access requests
- `POST /admin/requests/:id/approve` - Approve request
- `POST /admin/requests/:id/deny` - Deny request

## Database Schema

### users
- `id`: Primary key
- `email`: User email (unique)
- `password_hash`: bcrypt hashed password
- `is_admin`: Boolean admin flag
- `created_at`: Timestamp

### zones
- `id`: Primary key
- `name`: Zone name (e.g., parish.rubbish.dev)
- `user_id`: Foreign key to users
- `created_at`: Timestamp

### zone_requests
- `id`: Primary key
- `user_id`: Foreign key to users
- `zone_name`: Requested subdomain
- `reason`: User's justification
- `status`: pending/approved/denied
- `created_at`: Request timestamp
- `updated_at`: Last status change

## Development

### Build for Production
```bash
npm run build
```

### Preview Production Build
```bash
npm run preview
```

## Security Notes

- The `serverapp.js` file contains sensitive configuration and is excluded from git
- JWT tokens are stored in localStorage
- Passwords are hashed with bcrypt before storage
- API requests require valid JWT tokens
- Admin endpoints check user permissions

## License

MIT License
