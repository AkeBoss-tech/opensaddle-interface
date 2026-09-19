import React from 'react'

/** Deliberately small Markdown subset. HTML and unsupported syntax remain text. */
function safeInline(value:string){
 const parts:React.ReactNode[]=[]
 const pattern=/(`[^`\n]+`|\*\*[^*\n]+\*\*|\[([^\]]{1,200})\]\((https?:\/\/[^\s)]+)\))/g
 let cursor=0,match:RegExpExecArray|null
 while((match=pattern.exec(value))){
  parts.push(value.slice(cursor,match.index))
  const token=match[0],key=match.index
  if(token.startsWith('`'))parts.push(<code key={key}>{token.slice(1,-1)}</code>)
  else if(token.startsWith('**'))parts.push(<strong key={key}>{token.slice(2,-2)}</strong>)
  else parts.push(<a key={key} href={match[3]} target="_blank" rel="noreferrer">{match[2]}</a>)
  cursor=pattern.lastIndex
 }
 parts.push(value.slice(cursor));return parts
}
export function SafeMarkdown({text,omitLeadingHeading=false}:{text:string;omitLeadingHeading?:boolean}){const lines=text.split(/\r?\n/),firstContentIndex=lines.findIndex(line=>line.trim());let fenced=false;return <div className="artifact-report">{lines.map((line,index)=>{if(line.startsWith('```')){fenced=!fenced;return null}if(fenced)return <pre key={index}>{line}</pre>;const heading=/^(#{1,3})\s+(.+)$/.exec(line);if(heading){if(omitLeadingHeading&&index===firstContentIndex)return null;const H=`h${heading[1].length+1}` as 'h2'|'h3'|'h4';return <H key={index}>{safeInline(heading[2])}</H>}if(/^[-*]\s+/.test(line))return <p key={index}>• {safeInline(line.slice(2))}</p>;if(/^>\s?/.test(line))return <blockquote key={index}>{safeInline(line.replace(/^>\s?/,''))}</blockquote>;return line?<p key={index}>{safeInline(line)}</p>:<br key={index}/>})}</div>}
