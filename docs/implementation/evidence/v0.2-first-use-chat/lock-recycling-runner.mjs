import {databaseEnvironment} from '/app/deployment/database-env.mjs';
import {createRequire} from 'node:module';
const require=createRequire('/app/api/dist/main.js');
const {PrismaClient}=require('@townbase/database');
const clients=[];
try {
 for(const [key,lifetime] of [[98,2],[99,0]]) {
  const u=new URL(databaseEnvironment());u.searchParams.set('connection_limit','1');u.searchParams.set('max_idle_connection_lifetime',String(lifetime));
  const p=new PrismaClient({datasources:{db:{url:u.toString()}}});clients.push({p,key,lifetime});
  console.log({lifetime,acquired:await p.$queryRaw`SELECT pg_backend_pid() AS pid,pg_try_advisory_lock(741126,${key}::int) AS acquired`});
 }
 for(let i=0;i<16;i++) {
  await new Promise(r=>setTimeout(r,500));
  for(const {p,key,lifetime} of clients) console.log({i,lifetime,rows:await p.$queryRaw`SELECT pg_backend_pid() AS pid, EXISTS(SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND classid=741126::oid AND objid=${key}::oid AND objsubid=2) AS owned`});
 }
} finally {await Promise.all(clients.map(({p})=>p.$disconnect()));}
