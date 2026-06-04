# Knowledge Sharing (`knowledge/`)

**BKN Knowledge Sharing** hub — FAQs, items, and videos (vdos) for the pharmacy team, with login-gated editing.

## Data (server-direct, no localStorage cache)
Reads/writes go **directly to the pharmacy server** (the user rejected a localStorage cache for this):
- `GET/PUT /api/faqs`, `/api/items`, `/api/vdos`
- `POST /api/auth/login`, `/api/auth/logout` (editing requires editor/admin)
- Attachments served from `/api/ks-files/{filename}` (uploaded via `PUT /api/ks-files/{filename}`)

The popup's Knowledge tab and this page share the same server collections.

## Files
| File | Role |
|---|---|
| `index.html` | Sidebar + content layout |
| `app.js` | Fetch/render FAQs/Items/Vdos, auth, edit, file upload |
| `styles.css` | Styling |

## Gotchas
- Always fetch fresh from the server — do not reintroduce a localStorage cache for this cross-workstation data.
- Auth tokens are bearer tokens from `/api/auth/login`; `super_admin/admin/editor` roles gate writes.
