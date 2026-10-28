import urllib.request,urllib.error,http.cookiejar,json,uuid
base='http://localhost:8005'
def client():return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def call(c,path,method='GET',body=None):
 req=urllib.request.Request(base+'/api'+path,method=method,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json'})
 try:r=c.open(req);return r.status,json.load(r)
 except urllib.error.HTTPError as e:return e.code, json.loads(e.read() or '{}')
a,b,c=client(),client(),client();emails=[str(uuid.uuid4())+'@example.com' for _ in range(3)]
for cli,email in zip([a,b,c],emails):assert call(cli,'/auth/signup','POST',{'email':email,'password':'test-password-123'})[0]==200
w=call(a,'/workspaces')[1]['workspaces'][0]['id'];prefix='/workspaces/'+str(w)
assert call(b,prefix)[0]==404
status,invite=call(a,prefix+'/invites','POST',{'email':emails[1],'role':'Viewer'});assert status==200
assert call(c,'/workspaces/accept','POST',{'token':invite['token']})[0]==400
assert call(b,'/workspaces/accept','POST',{'token':invite['token']})[0]==200
assert call(b,'/workspaces/accept','POST',{'token':invite['token']})[0]==400
assert call(b,prefix,'PATCH',{'name':'illegal'})[0]==403
members=call(a,prefix)[1]['members'];bid=next(m['id'] for m in members if m['email']==emails[1]);aid=next(m['id'] for m in members if m['email']==emails[0])
assert call(a,prefix+'/members/'+str(bid),'PATCH',{'role':'Admin'})[0]==200
assert call(b,prefix+'/members/'+str(aid),'DELETE')[0]==403
assert call(b,prefix+'/invites','POST',{'email':emails[2],'role':'Admin'})[0]==400
assert call(b,prefix,'DELETE',{'name':'My workspace'})[0]==403
assert call(a,prefix+'/transfer','POST',{'user':bid})[0]==200
assert call(a,prefix,'DELETE',{'name':'My workspace'})[0]==403
assert call(b,prefix,'DELETE',{'name':'wrong'})[0]==400
assert call(b,prefix,'DELETE',{'name':'My workspace'})[0]==200
assert call(a,prefix)[0]==404
print('Passed: workspace isolation, invite ownership/replay, role restrictions, ownership transfer, deletion.')
