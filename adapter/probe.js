import { spawn } from "node:child_process";
import { execSync } from "node:child_process";
const KIRO = execSync("which kiro-cli").toString().trim();
const p = spawn(KIRO,["acp","--trust-all-tools"],{cwd:"/tmp",env:{...process.env,NO_COLOR:"1"}});
let buf="",id=2,sid=null;
const send=o=>p.stdin.write(JSON.stringify(o)+"\n");
p.stdout.on("data",d=>{buf+=d;let i;while((i=buf.indexOf("\n"))>=0){const l=buf.slice(0,i);buf=buf.slice(i+1);if(!l.trim())continue;let v;try{v=JSON.parse(l)}catch{continue}
 if(v.id===1&&v.result){sid=v.result.sessionId;send({jsonrpc:"2.0",id:id++,method:"session/prompt",params:{sessionId:sid,prompt:[{type:"text",text:"读取 /tmp/kiro_test.txt 内容"}]}});}
 else if(v.method==="session/update"&&v.params.update.sessionUpdate==="tool_call_update"){console.log("TCU:",JSON.stringify(v.params.update).slice(0,500));p.kill();process.exit(0);}
 else if(v.id===1&&v.error){console.log("ERR",JSON.stringify(v.error));process.exit(1)}
}});
send({jsonrpc:"2.0",id:0,method:"initialize",params:{protocolVersion:1,clientCapabilities:{fs:{readTextFile:true,writeTextFile:true}}}});
setTimeout(()=>send({jsonrpc:"2.0",id:1,method:"session/new",params:{cwd:"/tmp",mcpServers:[]}}),1200);
setTimeout(()=>{console.log("TIMEOUT");p.kill();process.exit(1)},60000);
