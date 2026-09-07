import {headers} from 'next/headers';
import {redirect} from 'next/navigation';

export type ChatGPTUser={userId:string;displayName:string;email:string;fullName:string|null};
const SIGN_IN_PATH='/signin-with-chatgpt';
const SIGN_OUT_PATH='/signout-with-chatgpt';
const CALLBACK_PATH='/callback';

export async function getChatGPTUser():Promise<ChatGPTUser|null>{
  const requestHeaders=await headers();
  const userId=requestHeaders.get('oai-authenticated-user-id');
  const email=requestHeaders.get('oai-authenticated-user-email');
  if(!userId||!email)return null;
  const encodedName=requestHeaders.get('oai-authenticated-user-full-name');
  const fullName=encodedName&&requestHeaders.get('oai-authenticated-user-full-name-encoding')==='percent-encoded-utf-8'?safeDecodeURIComponent(encodedName):null;
  return {userId,email,fullName,displayName:fullName??email};
}

export async function requireChatGPTUser(returnTo:string):Promise<ChatGPTUser>{
  const user=await getChatGPTUser();
  if(user)return user;
  redirect(chatGPTSignInPath(returnTo));
}

export async function requireApiUser():Promise<Response|null>{
  return await getChatGPTUser()?null:Response.json({error:'Authentication required'},{status:401});
}

export function chatGPTSignInPath(returnTo:string){return `${SIGN_IN_PATH}?return_to=${encodeURIComponent(safeRelativeReturnPath(returnTo))}`;}
export function chatGPTSignOutPath(returnTo='/'){return `${SIGN_OUT_PATH}?return_to=${encodeURIComponent(safeRelativeReturnPath(returnTo))}`;}

function safeRelativeReturnPath(value:string){
  if(!value.startsWith('/')||value.startsWith('//'))return '/';
  let url:URL;
  try{url=new URL(value,'https://app.local');}catch{return '/';}
  if(url.origin!=='https://app.local'||[SIGN_IN_PATH,SIGN_OUT_PATH,CALLBACK_PATH].includes(url.pathname))return '/';
  return `${url.pathname}${url.search}${url.hash}`;
}
function safeDecodeURIComponent(value:string){try{return decodeURIComponent(value);}catch{return null;}}
