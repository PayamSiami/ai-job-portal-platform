const API = "http://localhost:8000/api/auth";
const login = await fetch(API + "/login", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:"dbg@test.com",password:"Pass1234!"})});
const lj = JSON.parse(await login.text());
const tok = lj.data?.accessToken;
console.log("login", login.status, "token?", !!tok);
const me = await fetch(API + "/me", {headers: {Authorization:"Bearer "+tok}});
console.log("me", me.status, await me.text());
// Also raw: does gateway forward x-user-* to auth? auth-service /me uses them. Let's hit a required-auth route too:
const stat = await fetch("http://localhost:8000/api/applications/stats", {headers:{Authorization:"Bearer "+tok}});
console.log("app-stats(requires auth)", stat.status, (await stat.text()).slice(0,80));
