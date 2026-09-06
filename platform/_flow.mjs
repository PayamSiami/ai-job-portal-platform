const API = "http://localhost:8000/api/auth";
const reg = await fetch(API + "/register", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:"opt@test.com",password:"Pass1234!",username:"optuser",role:"job-seeker",profile:{firstName:"Opt"}})});
console.log("register", reg.status, (await reg.text()).slice(0,60));
const log = await fetch(API + "/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:"opt@test.com",password:"Pass1234!"})});
const t = await log.text();
console.log("login", log.status, t.slice(0,60));
const j = JSON.parse(t);
if (j.data?.accessToken) {
  const meReq = await fetch(API+"/me",{headers:{Authorization:"Bearer "+j.data.accessToken}});
  const meText = await meReq.text();
  console.log("me", meReq.status, meText.slice(0,80));
}
