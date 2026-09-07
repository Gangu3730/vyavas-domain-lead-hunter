import {requireChatGPTUser} from '@/app/chatgpt-auth';
import {VyavasWorkspace} from '@/components/vyavas/workspace';
export const dynamic='force-dynamic';
export default async function WorkspacePage(){
  const user=await requireChatGPTUser('/workspace');
  return <VyavasWorkspace user={{displayName:user.displayName,email:user.email}}/>;
}
