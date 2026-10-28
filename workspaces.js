import { randomBytes, createHash } from 'node:crypto';
export function workspaceRoutes(app, db, session) {
 db.pragma('foreign_keys = ON');
 db.exec(`CREATE TABLE IF NOT EXISTS workspaces(id INTEGER PRIMARY KEY, name TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS members(workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE, user_id INTEGER REFERENCES users(id), role TEXT NOT NULL, PRIMARY KEY(workspace_id,user_id));
 CREATE TABLE IF NOT EXISTS invites(id INTEGER PRIMARY KEY, workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE, email TEXT NOT NULL, role TEXT NOT NULL, hash TEXT UNIQUE NOT NULL, expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS activity(id INTEGER PRIMARY KEY, workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE, actor TEXT NOT NULL, action TEXT NOT NULL, created INTEGER NOT NULL);`);
 const roles = ['Admin','Editor','Publisher','Viewer'];
 const audit = (w,u,a) => db.prepare('INSERT INTO activity(workspace_id,actor,action,created) VALUES(?,?,?,?)').run(w,u.email,a,Date.now());
 const name = value => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 80 ? value.trim() : null;
 const create = db.transaction((user,title) => { const id = Number(db.prepare('INSERT INTO workspaces(name) VALUES(?)').run(title).lastInsertRowid); db.prepare('INSERT INTO members VALUES(?,?,?)').run(id,user.id,'Owner'); audit(id,user,'Workspace created'); return id; });
 const ensure = user => { if (!db.prepare('SELECT 1 FROM members WHERE user_id=?').get(user.id)) create(user,'My workspace'); };
 app.use('/api/workspaces', (req,res,next) => { req.user=session(req); if(!req.user) return res.status(401).json({error:'Please log in.'}); ensure(req.user); next(); });
 app.get('/api/workspaces', (req,res) => res.json({workspaces: db.prepare('SELECT w.id,w.name,m.role FROM workspaces w JOIN members m ON w.id=m.workspace_id WHERE m.user_id=? ORDER BY w.id').all(req.user.id)}));
 app.post('/api/workspaces', (req,res) => { const title=name(req.body.name); if(!title) return res.status(400).json({error:'Enter a workspace name (1–80 characters).'}); res.json({id:create(req.user,title)}); });
 app.post('/api/workspaces/accept', (req,res) => {
  if(typeof req.body.token!=='string' || req.body.token.length!==64) return res.status(400).json({error:'Invalid invitation.'});
  const hash=createHash('sha256').update(req.body.token).digest('hex');
  const result=db.transaction(()=>{const invite=db.prepare('SELECT * FROM invites WHERE hash=? AND expires>?').get(hash,Date.now());
   if(!invite || invite.email!==req.user.email) return null;
   db.prepare('INSERT OR IGNORE INTO members VALUES(?,?,?)').run(invite.workspace_id,req.user.id,invite.role);
   db.prepare('DELETE FROM invites WHERE id=?').run(invite.id); audit(invite.workspace_id,req.user,'Invitation accepted');return invite.workspace_id;})();
  if(!result) return res.status(400).json({error:'Invitation expired, already used, or addressed to another email.'});res.json({id:result});
 });
 app.use('/api/workspaces/:id', (req,res,next)=>{req.workspace=db.prepare('SELECT w.*,m.role FROM workspaces w JOIN members m ON w.id=m.workspace_id WHERE w.id=? AND m.user_id=?').get(req.params.id,req.user.id);if(!req.workspace)return res.status(404).json({error:'Workspace not found.'});next();});
 const manage=(req,res,next)=> ['Owner','Admin'].includes(req.workspace.role)?next():res.status(403).json({error:'Only owners and admins can manage members.'});
 const owner=(req,res,next)=> req.workspace.role==='Owner'?next():res.status(403).json({error:'Only the owner can do this.'});
 app.get('/api/workspaces/:id',(req,res)=>res.json({workspace:req.workspace,members:db.prepare('SELECT u.id,u.email,m.role FROM members m JOIN users u ON u.id=m.user_id WHERE workspace_id=?').all(req.workspace.id),invites:['Owner','Admin'].includes(req.workspace.role)?db.prepare('SELECT id,email,role,expires FROM invites WHERE workspace_id=? AND expires>?').all(req.workspace.id,Date.now()):[],activity:db.prepare('SELECT actor,action,created FROM activity WHERE workspace_id=? ORDER BY id DESC LIMIT 50').all(req.workspace.id)}));
 app.patch('/api/workspaces/:id',manage,(req,res)=>{const title=name(req.body.name);if(!title)return res.status(400).json({error:'Enter a valid workspace name.'});db.transaction(()=>{db.prepare('UPDATE workspaces SET name=? WHERE id=?').run(title,req.workspace.id);audit(req.workspace.id,req.user,`Workspace renamed to ${title}`);})();res.json({ok:true});});
 app.post('/api/workspaces/:id/invites',manage,(req,res)=>{
  const email=typeof req.body.email==='string'?req.body.email.trim().toLowerCase():'';const role=req.body.role;
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||!roles.includes(role)||(role==='Admin'&&req.workspace.role!=='Owner'))return res.status(400).json({error:'Choose a valid email and allowed role. Only owners can appoint admins.'});
  if(db.prepare('SELECT 1 FROM members m JOIN users u ON m.user_id=u.id WHERE workspace_id=? AND email=?').get(req.workspace.id,email))return res.status(409).json({error:'This user is already a member.'});
  const token=randomBytes(32).toString('hex');const hash=createHash('sha256').update(token).digest('hex');
  db.transaction(()=>{db.prepare('DELETE FROM invites WHERE workspace_id=? AND email=?').run(req.workspace.id,email);db.prepare('INSERT INTO invites(workspace_id,email,role,hash,expires) VALUES(?,?,?,?,?)').run(req.workspace.id,email,role,hash,Date.now()+7*86400000);audit(req.workspace.id,req.user,`Invited ${email} as ${role}`);})();res.json({token});
 });
 app.delete('/api/workspaces/:id/invites/:invite',manage,(req,res)=>{const invite=db.prepare('SELECT * FROM invites WHERE id=? AND workspace_id=?').get(req.params.invite,req.workspace.id);if(!invite)return res.sendStatus(404);if(invite.role==='Admin'&&req.workspace.role!=='Owner')return res.sendStatus(403);db.transaction(()=>{db.prepare('DELETE FROM invites WHERE id=?').run(invite.id);audit(req.workspace.id,req.user,`Invitation revoked for ${invite.email}`);})();res.json({ok:true});});
 const target=(req,res,next)=>{req.member=db.prepare('SELECT * FROM members WHERE workspace_id=? AND user_id=?').get(req.workspace.id,req.params.user);if(!req.member)return res.status(404).json({error:'Member not found.'});if(req.member.role==='Owner'||(req.workspace.role!=='Owner'&&req.member.role==='Admin'))return res.status(403).json({error:'You cannot change this member.'});next();};
 app.patch('/api/workspaces/:id/members/:user',manage,target,(req,res)=>{const role=req.body.role;if(!roles.includes(role)||(role==='Admin'&&req.workspace.role!=='Owner'))return res.status(403).json({error:'Role not allowed.'});db.transaction(()=>{db.prepare('UPDATE members SET role=? WHERE workspace_id=? AND user_id=?').run(role,req.workspace.id,req.member.user_id);audit(req.workspace.id,req.user,`Member ${req.member.user_id} role changed to ${role}`);})();res.json({ok:true});});
 app.delete('/api/workspaces/:id/members/:user',manage,target,(req,res)=>{db.transaction(()=>{db.prepare('DELETE FROM members WHERE workspace_id=? AND user_id=?').run(req.workspace.id,req.member.user_id);audit(req.workspace.id,req.user,`Member ${req.member.user_id} removed`);})();res.json({ok:true});});
 app.post('/api/workspaces/:id/transfer',owner,(req,res)=>{if(req.body.user===req.user.id||!db.prepare('SELECT 1 FROM members WHERE workspace_id=? AND user_id=?').get(req.workspace.id,req.body.user))return res.status(400).json({error:'Choose another existing member.'});db.transaction(()=>{db.prepare("UPDATE members SET role='Admin' WHERE workspace_id=? AND user_id=?").run(req.workspace.id,req.user.id);db.prepare("UPDATE members SET role='Owner' WHERE workspace_id=? AND user_id=?").run(req.workspace.id,req.body.user);audit(req.workspace.id,req.user,`Ownership transferred to member ${req.body.user}`);})();res.json({ok:true});});
 app.delete('/api/workspaces/:id',owner,(req,res)=>{if(req.body.name!==req.workspace.name)return res.status(400).json({error:'Type the workspace name to confirm deletion.'});db.prepare('DELETE FROM workspaces WHERE id=?').run(req.workspace.id);res.json({ok:true});});
}
