import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
export const digest = value => crypto.createHash('sha256').update(value).digest('hex');
export const secret = () => crypto.randomBytes(32).toString('base64url');
export const storageRoot = () => process.env.DATA_DIR || path.resolve('data/runtime');
let database, location;
export function db() {
 const file=path.join(storageRoot(),'profiles.sqlite');
 if(database && location===file)return database;
 fs.mkdirSync(path.dirname(file),{recursive:true});
 database=new DatabaseSync(file);location=file;
 database.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL, expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS oauth (state TEXT PRIMARY KEY, verifier TEXT NOT NULL, nonce TEXT NOT NULL, expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL, config TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, enabled INTEGER NOT NULL DEFAULT 0, token_hash TEXT, updated TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
 CREATE INDEX IF NOT EXISTS profiles_owner ON profiles(owner);
 CREATE TABLE IF NOT EXISTS subscription_keys (profile_id TEXT PRIMARY KEY, encrypted TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sounds (profile_id TEXT NOT NULL, name TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY(profile_id,name));
 CREATE TABLE IF NOT EXISTS revisions (profile_id TEXT NOT NULL, revision TEXT NOT NULL, config_version INTEGER NOT NULL, manifest TEXT NOT NULL, created TEXT NOT NULL, PRIMARY KEY(profile_id,revision));
 CREATE TABLE IF NOT EXISTS subscription_devices (
   profile_id TEXT NOT NULL, device_hash TEXT NOT NULL, PRIMARY KEY(profile_id, device_hash)
 );
 CREATE TABLE IF NOT EXISTS sync_status (profile_id TEXT PRIMARY KEY, latest TEXT, error TEXT, checked TEXT);
 `);return database;
}
export function sessionUser(token) {
 if(!token)return null;
 const row=db().prepare('SELECT owner,name FROM sessions WHERE hash=? AND expires>?').get(digest(token),Date.now());
 return row || null;
}
export function createSession(owner,name) {const token=secret();db().prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(digest(token),owner,name,Date.now()+7*86400000);return token;}
export function profileRow(id,owner) { return db().prepare('SELECT * FROM profiles WHERE id=? AND owner=? AND deleted=0').get(id,owner); }
export function countSubscriptionDevice(profileId, tokenHash, deviceId) {
 if (!deviceId || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deviceId)) return;
 const deviceHash = digest(profileId + '\0' + deviceId.toLowerCase());
 db().prepare(`INSERT OR IGNORE INTO subscription_devices(profile_id, device_hash)
   SELECT id, ? FROM profiles WHERE id=? AND deleted=0 AND enabled=1 AND token_hash=?`).run(deviceHash, profileId, tokenHash);
}
export function summary(row) {
 const { count } = db().prepare('SELECT COUNT(*) AS count FROM subscription_devices WHERE profile_id=?').get(row.id);
 return {id:row.id,name:row.name,profile:JSON.parse(row.config),version:row.version,subscriptionEnabled:Boolean(row.enabled),subscriberCount:count,updatedAt:row.updated};
}
export function authorizeSync(id,token) {
 if(!token)return null;
 const row=db().prepare('SELECT * FROM profiles WHERE id=? AND deleted=0 AND enabled=1 AND token_hash=?').get(id,digest(token));return row || null;
}
export function putSound(bytes) {
 const hash=digest(bytes),directory=path.join(storageRoot(),'sounds');fs.mkdirSync(directory,{recursive:true});
 const target=path.join(directory,hash);if(!fs.existsSync(target))fs.writeFileSync(target,bytes,{flag:'wx'});return hash;
}
export function soundBytes(hash){if(!/^[a-f0-9]{64}$/.test(hash))throw new Error('Invalid sound');return fs.readFileSync(path.join(storageRoot(),'sounds',hash));}
export function encryptKey(value){
 const file=path.join(storageRoot(),'.subscription-key');
 if(!fs.existsSync(file))try{fs.writeFileSync(file,crypto.randomBytes(32),{mode:0o600,flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}
 const key=fs.readFileSync(file),iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
 return Buffer.concat([iv,cipher.update(value,'utf8'),cipher.final(),cipher.getAuthTag()]).toString('base64url');
}
export function decryptKey(value){const data=Buffer.from(value,'base64url'),key=fs.readFileSync(path.join(storageRoot(),'.subscription-key'));const cipher=crypto.createDecipheriv('aes-256-gcm',key,data.subarray(0,12));cipher.setAuthTag(data.subarray(-16));return Buffer.concat([cipher.update(data.subarray(12,-16)),cipher.final()]).toString();}
