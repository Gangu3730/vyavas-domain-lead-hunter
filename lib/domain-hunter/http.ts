export function json(data:unknown,status=200){return Response.json(data,{status,headers:{'Cache-Control':'no-store'}})}
export function fail(error:unknown,status=500){const message=error instanceof Error?error.message:'Unexpected error';return json({error:message},status)}
export function positiveInt(value:string|null,fallback:number,max:number){const n=Number(value);return Number.isInteger(n)&&n>0?Math.min(n,max):fallback}
