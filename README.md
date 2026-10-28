# 8LM email/password login

Run `npm ci` then `npm start`. Open http://localhost:8000.

Includes signup, scrypt password hashing, seven-day server-side sessions, sign-out, and login rate limiting. Accounts and sessions use SQLite at `data/8lm.db`; no Google integration is included.

Production settings: NODE_ENV=production, APP_ORIGIN=https://your-domain, DATABASE_PATH=/persistent-disk/8lm.db. Attach persistent storage before deploying on Render, otherwise accounts can disappear across deployments. This implementation runs as a single instance. Email verification and password recovery are not implemented yet.

## Workspaces

Signed-in users receive a personal workspace when they first load the workspace list. Create/switch/rename workspaces, invite members, revoke invitations, assign roles, remove members, transfer ownership and delete a workspace. Membership is checked on every workspace request. Admins cannot manage owners or other admins, or appoint admins. Only owners transfer ownership or delete workspaces. Activity is retained for the latest 50 displayed events; deleting a workspace also deletes its activity.

Invitations are single-use, expire after seven days, and require both possession of the link and login with the addressed email. Only token hashes are stored. No email is sent: the inviter shares the link privately. Email verification and recovery remain unimplemented. Editor, Publisher and Viewer cannot manage membership; their campaign-specific distinctions and per-Ads-account access are reserved for the future Google Ads module.

Run integration checks against an isolated server on port 8005 with `python3 test/workspaces.py`. The test creates and deletes fixture workspaces, so use a test database. SQLite must reside on persistent storage for deployment. Do not use multiple app instances against separate database files.
