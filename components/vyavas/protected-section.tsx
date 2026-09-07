import type {ReactNode} from 'react';
import {requireChatGPTUser} from '@/app/chatgpt-auth';
export async function ProtectedSection({children,returnTo}:{children:ReactNode;returnTo:string}){
  await requireChatGPTUser(returnTo);
  return children;
}
