const API = "http://localhost:8000/api/auth";
const dbg = "http://localhost:8000/debug-auth";

const reg = await fetch(API + "/register", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:"dbg@test.com",password:"Pass1234!",username:"dbguser",role:"job-seeker",profile:{firstName:"X"}})});
console.log("register", reg.status);
const login = await fetch(API + "/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:"dbg@test.com",password:"Pass1234!"})});
const lj = JSON.parse(await login.text());
console.log("login", login.status, "token?", !!lj.data?.accessToken);
const tok = lj.data?.accessToken;
const r = await fetch(dbg, {headers: tok ? {Authorization:"Bearer "+tok} : {}});
console.log("debug", r.status, await r.text());
const r2 = await fetch(dbg);
console.log("debug(no token)", r2.status, await r2.text());
