import type {ReactNode} from 'react';
import {ProtectedSection} from '@/components/vyavas/protected-section';
export const dynamic='force-dynamic';
export default function Layout({children}:{children:ReactNode}){return <ProtectedSection returnTo="/domain-hunter">{children}</ProtectedSection>;}
