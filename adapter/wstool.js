import WebSocket from "ws";
const resp = await fetch("http://127.0.0.1:3789/api/sessions", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({workDir:"/tmp",model:"auto",agent:"kiro_default"})});
const { session } = await resp.json();
const ws = new WebSocket(`ws://127.0.0.1:3789/ws/${encodeURIComponent(session.id)}`);
let c=false;
ws.on("message",(d)=>{ const m=JSON.parse(d.toString());
  if(m.type==="content_delta")process.stdout.write(m.text||"");
  else console.log("[MSG]",JSON.stringify(m).slice(0,180));
  if(m.type==="connected"&&!c){c=true;setTimeout(()=>ws.send(JSON.stringify({type:"user_message",content:"读取 /tmp/kiro_test.txt 内容",attachments:[]})),1500);}
  if(m.type==="message_complete"){ws.close();process.exit(0);}
});
ws.on("error",e=>{console.log("ERR",e.message);process.exit(1)});
setTimeout(()=>{console.log("TIMEOUT");process.exit(1)},90000);
