export type Confidence='HIGH'|'MEDIUM'|'LOW'|'UNKNOWN';
export interface DiscoveryBatch{source:string;sourceType:'newly_detected_domain';date:string;generatedAt?:string;domains:string[];rawMetadata:Record<string,unknown>}
export interface DomainDiscoveryProvider{readonly name:string;getTodayDomains():Promise<DiscoveryBatch>;getDomainsForDate(date:string):Promise<DiscoveryBatch>;getRecentDomains(days:number):Promise<DiscoveryBatch[]>}
export interface WebsiteEvidence{field:string;value:string;sourceUrl:string;snippet?:string;confidence:Confidence}
