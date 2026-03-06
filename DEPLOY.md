# Deploy MCMS to anupchavan.com/mcms

This guide gets the app running at **https://anupchavan.com/mcms** with login and full functionality.

---

## If anupchavan.com is already a Jekyll site (your case)

Your main site is Jekyll; any unknown path (like `/mcms`) currently goes to Jekyll’s 404. So **the server in front** (nginx, Apache, etc.) must send **only** `/mcms` and `/api` (and `/socket.io`) to the Node app; everything else keeps going to Jekyll.

**You need nginx (or similar) in front of both:**

1. **Jekyll** – still serves the rest of the site (e.g. `/`, `/blog`, etc.).
2. **Node** – serves only `/api`, `/socket.io`, and `/mcms` (MCMS app).

So nginx must define `location /api`, `location /socket.io`, and `location /mcms` **first**, and proxy those to the Node server (e.g. `http://127.0.0.1:5001`). The **default** server block (or `location /`) continues to serve your Jekyll `_site` (or wherever Jekyll output is).

**Example nginx server block** (add or merge with your existing `server { ... }` for `anupchavan.com`):

```nginx
server {
    listen 443 ssl;
    server_name anupchavan.com www.anupchavan.com;
    # ... your existing ssl_* and root for Jekyll ...

    root /path/to/your/jekyll/_site;   # Jekyll output
    index index.html;

    # MCMS API and Socket.io → Node (must come before location /)
    location /api {
        proxy_pass http://127.0.0.1:5001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location /socket.io {
        proxy_pass http://127.0.0.1:5001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
    # MCMS app → Node (serves the built React app)
    location /mcms {
        proxy_pass http://127.0.0.1:5001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Everything else → Jekyll (your existing site)
    location / {
        try_files $uri $uri/ $uri.html /404.html;
    }
}
```

**Checklist:**

- Node app is running (e.g. `node index.js` in the server folder) and listening on `127.0.0.1:5001`, and `client/dist` exists so the app serves `/mcms`.
- In `server/.env`: `CLIENT_URL=https://anupchavan.com`.
- In `client/.env.production`: `VITE_API_URL=https://anupchavan.com/api`, then run `npm run build` in `client/`.
- Reload nginx: `sudo nginx -t && sudo systemctl reload nginx` (or your reload command).

After that, **https://anupchavan.com** stays Jekyll, and **https://anupchavan.com/mcms** is MCMS.

**If you can’t change nginx** (e.g. Jekyll on GitHub Pages): use a **subdomain** for MCMS, e.g. **mcms.anupchavan.com**, and point that subdomain’s DNS to the machine where Node runs. Then build the client with `VITE_API_URL=https://mcms.anupchavan.com/api` and base `/` (see “Subdomain” below).

---

## 1. Build the client (from project root)

```bash
cd client
npm ci
# Set API URL for production (use your real API URL)
echo "VITE_API_URL=https://anupchavan.com/api" > .env.production
npm run build
cd ..
```

This creates `client/dist/` with base path `/mcms/`, so all assets will load from `anupchavan.com/mcms/`.

---

## 2. Configure the server

```bash
cd server
cp .env.production.example .env
# Edit .env and set at least: CLIENT_URL, JWT_SECRET, and (optional) MONGO_URI
```

### Where to get the values

**`JWT_SECRET`** – You don’t “get” this from anywhere; you **make it up**. It’s a secret string used to sign and verify login tokens. It must be long and random so others can’t guess it.

- **Generate one** (run in terminal):
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
- Put that output in `.env` as: `JWT_SECRET=the_long_hex_string_you_got`
- **Keep it secret**: don’t commit `.env` to git or share it. If it leaks, anyone could forge login tokens.

**`MONGO_URI`** – Only needed if you want **persistent data** (users, meetings, polls, etc. saved in a database).

- **If you use MongoDB:**
  - **Local:** `MONGO_URI=mongodb://127.0.0.1:27017/mcms_db`
  - **Cloud (e.g. MongoDB Atlas):** In the Atlas dashboard, create a cluster, get the connection string, and set e.g. `MONGO_URI=mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/mcms_db?retryWrites=true&w=majority`
- **If you skip it:** The server will run without MongoDB and use in-memory storage. Data (users, meetings) is lost when the server restarts. Fine for quick testing; use MongoDB for real use.

---

## 3. Run the server (option A – same host as API)

**What this means:** Your Node server runs on one machine (e.g. your VPS or the same box as anupchavan.com). That single process does two things: (1) serves the **API** (login, meetings, etc.) and (2) serves the **built MCMS app** (the React files) under `/mcms`. So you don’t need a separate static file server for the app.

**Steps:**

1. Build the client (step 1) so `client/dist` exists.
2. In `server/.env`, set `PORT` (e.g. `5001`) and `CLIENT_URL=https://anupchavan.com`.
3. Start the server: `node index.js` or `npm start`.
4. The server listens on `http://localhost:5001` and:
   - **API** → `http://localhost:5001/api` (and Socket.io on the same port)
   - **MCMS app** → `http://localhost:5001/mcms` and `http://localhost:5001/mcms/*` (files from `client/dist`).

**Reverse proxy in front:** Browsers will use `https://anupchavan.com`, not `localhost`. So nginx (or another reverse proxy) on that machine should:

- Send `https://anupchavan.com/api` and `https://anupchavan.com/socket.io` to `http://localhost:5001`
- Send `https://anupchavan.com/mcms` (and `/mcms/*`) to `http://localhost:5001` as well

So all traffic for API and MCMS goes to the same Node process on port 5001.

---

## 4. Run behind nginx (option B – nginx serves static, proxies API)

If you prefer nginx to serve the built files directly:

**nginx snippet:**

```nginx
# API and Socket.io
location /api {
    proxy_pass http://127.0.0.1:5001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
location /socket.io {
    proxy_pass http://127.0.0.1:5001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
# MCMS SPA (built client)
location /mcms {
    alias /path/to/your/SWE_meeting_and_communication_platform/client/dist;
    try_files $uri $uri/ /mcms/index.html;
}
```

- Build the client with `VITE_API_URL=https://anupchavan.com/api` (step 1).
- Run the server with `CLIENT_URL=https://anupchavan.com` and no need to serve `client/dist` from Node.
- Deploy `client/dist` to the path used in `alias` above.

---

## 5. Environment summary

| Variable | Where | Purpose |
|----------|--------|---------|
| `VITE_API_URL` | client `.env.production` | Full API URL, e.g. `https://anupchavan.com/api` |
| `CLIENT_URL` | server `.env` | Frontend origin for CORS and links, e.g. `https://anupchavan.com` |
| `JWT_SECRET` | server `.env` | Secret for signing login tokens — you generate it (see section 2). |
| `MONGO_URI` | server `.env` | MongoDB connection string — optional; see section 2. |

---

## 6. Test

1. Open **https://anupchavan.com/mcms**
2. You should see the MCMS login/signup screen.
3. Register or log in; the app will call `https://anupchavan.com/api` and Socket.io on the same origin.
4. If you use a separate API origin (e.g. `https://api.anupchavan.com`), set `VITE_API_URL=https://api.anupchavan.com/api` and ensure that server allows CORS from `https://anupchavan.com`.

---

## 7. Optional: Socket.io and same-origin

If the frontend is at `https://anupchavan.com/mcms` and the API at `https://anupchavan.com`, Socket.io will use the same host; no extra config. If the API is on a subdomain (e.g. `api.anupchavan.com`), the client already uses `VITE_API_URL` to derive the Socket.io URL (host without `/api`), so it will connect to the correct server.

---

## 8. Alternative: Subdomain (e.g. mcms.anupchavan.com)

If you **cannot** change routing on the main domain (e.g. anupchavan.com is on GitHub Pages), use a **subdomain** for MCMS:

1. Add a DNS A/CNAME record: `mcms.anupchavan.com` → IP or host where your Node server runs.
2. On that server, nginx (or similar) serves **only** MCMS: root or proxy for `mcms.anupchavan.com` to the Node app.
3. Build the client for the subdomain:
   - In `client/vite.config.js`, for this build you can use `base: '/'` (app at root of subdomain).
   - Set `VITE_API_URL=https://mcms.anupchavan.com/api` (API on same subdomain) and build.
4. In `server/.env` set `CLIENT_URL=https://mcms.anupchavan.com`.

Then the app lives at **https://mcms.anupchavan.com** and the main Jekyll site stays at **https://anupchavan.com**.
