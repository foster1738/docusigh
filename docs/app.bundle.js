"use strict";var Bulletproof=(()=>{var u=Object.defineProperty;var T=Object.getOwnPropertyDescriptor;var B=Object.getOwnPropertyNames;var v=Object.prototype.hasOwnProperty;var z=(t,e)=>{for(var r in e)u(t,r,{get:e[r],enumerable:!0})},F=(t,e,r,o)=>{if(e&&typeof e=="object"||typeof e=="function")for(let n of B(e))!v.call(t,n)&&n!==r&&u(t,n,{get:()=>e[n],enumerable:!(o=T(e,n))||o.enumerable});return t};var I=t=>F(u({},"__esModule",{value:!0}),t);var W={};z(W,{DEFAULT_THEME:()=>d,blocksFromText:()=>f,escapeHtml:()=>l,inlineFormat:()=>p,renderBulletproofEmail:()=>g,renderSimpleEmail:()=>y,renderText:()=>b,safeColor:()=>c,safeUrl:()=>s});var U={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"};function l(t){return t.replace(/[&<>"']/g,e=>U[e]??e)}function s(t){let r=t.trim().replace(/[\u0000-\u0020\u007f-\u00a0]/g,"");return/^(https?:|mailto:)/i.test(r)?l(r):/^[a-z][a-z0-9+.-]*:/i.test(r)?"#":l(r)}function c(t,e){let r=t.trim();return/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(r)||/^rgba?\(\s*[\d.\s,%/]+\)$/i.test(r)||/^[a-z]{1,20}$/i.test(r)?r:e}var d={brandColor:"#2563eb",backgroundColor:"#f4f4f7",cardColor:"#ffffff",textColor:"#333333",mutedColor:"#6b7280",buttonTextColor:"#ffffff",fontFamily:"-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji'",width:600,borderRadius:8};function g(t){let e=H(t.theme),r=N(t.lang??"en","en"),o=t.dir==="rtl"?"rtl":"ltr",n=Math.max(320,Math.min(800,Math.round(e.width))),i=l(t.title??t.header?.name??""),a=t.preheader?R(t.preheader):"",h=t.header?j(t.header,e,n):"",$=t.blocks.map(k=>D(k,e,n)).join(`
`),E=t.footer?O(t.footer,e):"",w=M({lang:r,dir:o,title:i,theme:e,width:n,preheader:a,header:h,body:$,footer:E}),C=b(t);return{html:w,text:C}}function H(t){let e={...d,...t};return{brandColor:c(e.brandColor,d.brandColor),backgroundColor:c(e.backgroundColor,d.backgroundColor),cardColor:c(e.cardColor,d.cardColor),textColor:c(e.textColor,d.textColor),mutedColor:c(e.mutedColor,d.mutedColor),buttonTextColor:c(e.buttonTextColor,d.buttonTextColor),fontFamily:e.fontFamily,width:e.width,borderRadius:Math.max(0,Math.min(40,Math.round(e.borderRadius)))}}function M(t){let{theme:e,width:r}=t,o=m(e.fontFamily);return`<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "https://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" lang="${t.lang}" dir="${t.dir}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no" />
<title>${t.title}</title>
<!--[if mso]>
<noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch><o:AllowPNG/></o:OfficeDocumentSettings></xml></noscript>
<![endif]-->
<!--[if mso]>
<style type="text/css">
  table, td, div, p, a { font-family: Arial, Helvetica, sans-serif !important; }
</style>
<![endif]-->
<style type="text/css">
  html, body { margin: 0 !important; padding: 0 !important; height: 100% !important; width: 100% !important; }
  * { -ms-text-size-adjust: 100%; -webkit-text-size-adjust: 100%; }
  table, td { mso-table-lspace: 0pt !important; mso-table-rspace: 0pt !important; border-collapse: collapse !important; }
  img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
  a { text-decoration: none; }
  a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; }
  .es-btn a { color: ${e.buttonTextColor}; }
  @media only screen and (max-width: ${r}px) {
    .es-container { width: 100% !important; }
    .es-pad { padding-left: 24px !important; padding-right: 24px !important; }
    .es-btn a { display: block !important; }
    .es-h1 { font-size: 24px !important; line-height: 30px !important; }
  }
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  @media (prefers-color-scheme: dark) {
    body, .es-body { background: #0b0d12 !important; }
    .es-card { background: #1a1d24 !important; }
    .es-text, .es-h1, .es-h2, .es-h3 { color: #e6e8ec !important; }
    .es-muted { color: #9aa1ac !important; }
    .es-divider { border-color: #2b2f38 !important; }
    .es-callout { background: #14171d !important; }
  }
</style>
</head>
<body class="es-body" style="margin:0;padding:0;width:100%;background:${e.backgroundColor};-webkit-font-smoothing:antialiased;">
${t.preheader}
<div role="article" aria-roledescription="email" aria-label="${t.title}" lang="${t.lang}" dir="${t.dir}" style="background:${e.backgroundColor};">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${e.backgroundColor};">
<tr><td align="center" style="padding:24px 12px;">
<!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" width="${r}" align="center"><tr><td><![endif]-->
<table role="presentation" class="es-container" cellpadding="0" cellspacing="0" width="${r}" style="width:${r}px;max-width:${r}px;margin:0 auto;">
${t.header}
<tr><td class="es-card es-pad" style="background:${e.cardColor};border-radius:${e.borderRadius}px;padding:40px;font-family:${o};">
${t.body}
</td></tr>
${t.footer}
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</div>
</body>
</html>`}function R(t){let e="&#847;&zwnj;&nbsp;".repeat(60);return`<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${l(t)}${e}</div>`}function j(t,e,r){let o=m(e.fontFamily),n;if(t.logoUrl){let i=t.logoWidth??160,a=`<img src="${s(t.logoUrl)}" alt="${m(t.name)}" width="${i}" style="display:block;border:0;outline:none;text-decoration:none;height:auto;max-width:${i}px;" />`;n=t.href?`<a href="${s(t.href)}" target="_blank">${a}</a>`:a}else{let i=`<span style="font-family:${o};font-size:22px;font-weight:700;color:${e.brandColor};">${l(t.name)}</span>`;n=t.href?`<a href="${s(t.href)}" target="_blank" style="text-decoration:none;">${i}</a>`:i}return`<tr><td class="es-pad" align="center" style="padding:8px 40px 24px;">${n}</td></tr>`}function D(t,e,r){switch(t.type){case"heading":return P(t.text,t.level??1,e);case"text":return _(t.text,e,t.muted??!1,t.align??"left");case"html":return`<div class="es-text" style="color:${e.textColor};font-size:16px;line-height:24px;">${t.trustedHtml}</div>`;case"button":return A(t.text,t.url,e);case"image":return S(t,r);case"divider":return'<table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr><td style="padding:24px 0;"><div class="es-divider" style="border-top:1px solid #e5e7eb;font-size:0;line-height:0;">&nbsp;</div></td></tr></table>';case"spacer":{let o=Math.max(1,Math.min(120,Math.round(t.height??24)));return`<div style="line-height:${o}px;height:${o}px;font-size:1px;">&nbsp;</div>`}case"callout":return L(t.text,e);default:return""}}function P(t,e,r){let o={1:[28,34],2:[22,28],3:[18,24]},[n,i]=o[e],a=m(r.fontFamily);return`<h${e} class="es-h${e}" style="margin:0 0 16px;font-family:${a};font-size:${n}px;line-height:${i}px;font-weight:700;color:${r.textColor};">${p(t,r)}</h${e}>`}function _(t,e,r,o){let n=r?e.mutedColor:e.textColor,i=r?"es-muted":"es-text",a=o==="center"||o==="right"?o:"left";return`<p class="${i}" style="margin:0 0 16px;font-family:${m(e.fontFamily)};font-size:16px;line-height:24px;color:${n};text-align:${a};">${p(t,e)}</p>`}function A(t,e,r){let o=s(e),n=l(t),i=m(r.fontFamily),a=r.borderRadius;return`<table role="presentation" class="es-btn" cellpadding="0" cellspacing="0" width="100%" style="margin:8px 0 24px;"><tr><td align="center">
<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${o}" style="height:48px;v-text-anchor:middle;width:280px;" arcsize="${Math.round(a/24*100)}%" strokecolor="${r.brandColor}" fillcolor="${r.brandColor}">
<w:anchorlock/>
<center style="color:${r.buttonTextColor};font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">${n}</center>
</v:roundrect>
<![endif]-->
<!--[if !mso]><!-- -->
<a href="${o}" target="_blank" style="background:${r.brandColor};border-radius:${a}px;color:${r.buttonTextColor};display:inline-block;font-family:${i};font-size:16px;font-weight:bold;line-height:48px;text-align:center;text-decoration:none;width:280px;-webkit-text-size-adjust:none;mso-hide:all;">${n}</a>
<!--<![endif]-->
</td></tr></table>`}function S(t,e){let r=Math.min(t.width??e-80,e),o=`<img src="${s(t.src)}" alt="${m(t.alt)}" width="${r}" style="display:block;border:0;outline:none;text-decoration:none;height:auto;max-width:100%;margin:0 auto;" />`;return`<table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr><td align="center" style="padding:8px 0 24px;">${t.href?`<a href="${s(t.href)}" target="_blank">${o}</a>`:o}</td></tr></table>`}function L(t,e){return`<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;"><tr><td class="es-callout" style="background:#f3f4f6;border-left:4px solid ${e.brandColor};border-radius:4px;padding:16px 20px;font-family:${m(e.fontFamily)};font-size:15px;line-height:22px;color:${e.textColor};">${p(t,e)}</td></tr></table>`}function O(t,e){let r=m(e.fontFamily),o=[];for(let n of t.lines??[])o.push(l(n));if(t.address&&o.push(l(t.address)),t.unsubscribeUrl){let n=l(t.unsubscribeText??"Unsubscribe");o.push(`<a href="${s(t.unsubscribeUrl)}" target="_blank" style="color:${e.mutedColor};text-decoration:underline;">${n}</a>`)}return o.length===0?"":`<tr><td class="es-pad" align="center" style="padding:24px 40px;font-family:${r};font-size:12px;line-height:18px;color:${e.mutedColor};" class="es-muted">${o.join("<br />")}</td></tr>`}function p(t,e){let r=l(t);return r=r.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,(o,n,i)=>`<a href="${s(i)}" target="_blank" style="color:${e.brandColor};text-decoration:underline;">${n}</a>`),r=r.replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>"),r=r.replace(/(^|[^*])\*([^*]+)\*/g,"$1<em>$2</em>"),r=r.replace(/\n/g,"<br />"),r}function b(t){let e=[];t.preheader&&e.push(t.preheader,""),t.header?.name&&e.push(t.header.name.toUpperCase(),"");for(let o of t.blocks)switch(o.type){case"heading":e.push(x(o.text),"");break;case"text":case"callout":e.push(x(o.text),"");break;case"button":e.push(`${x(o.text)}: ${o.url}`,"");break;case"image":o.href?e.push(`${o.alt}: ${o.href}`,""):o.alt&&e.push(`[${o.alt}]`,"");break;case"divider":e.push("----------------------------------------","");break;case"html":e.push(o.trustedHtml.replace(/<[^>]+>/g,"").trim(),"");break;case"spacer":break}let r=[];for(let o of t.footer?.lines??[])r.push(o);return t.footer?.address&&r.push(t.footer.address),t.footer?.unsubscribeUrl&&r.push(`${t.footer.unsubscribeText??"Unsubscribe"}: ${t.footer.unsubscribeUrl}`),r.length&&e.push("--",...r),e.join(`
`).replace(/\n{3,}/g,`

`).trim()+`
`}function x(t){return t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,"$1 ($2)").replace(/\*\*([^*]+)\*\*/g,"$1").replace(/\*([^*]+)\*/g,"$1")}function m(t){return l(t)}function N(t,e){return/^[a-z]{2}(-[a-z0-9]{2,8})*$/i.test(t.trim())?t.trim():e}function f(t){let e=[],r=t.replace(/\r\n/g,`
`).split(/\n\s*\n/);for(let o of r){let n=o.trim();if(!n)continue;let i=n.match(/^(#{1,3})\s+(.*)$/);if(i&&!n.includes(`
`)){let h=i[1].length;e.push({type:"heading",text:i[2].trim(),level:h});continue}let a=n.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);if(a){e.push({type:"button",text:a[1].trim(),url:a[2]});continue}e.push({type:"text",text:n})}return e}function y(t){let e=[];t.heading&&e.push({type:"heading",text:t.heading}),t.greeting&&e.push({type:"text",text:t.greeting}),e.push(...f(t.body)),t.button&&e.push({type:"button",text:t.button.text,url:t.button.url});let r=t.preheader??t.heading??q(t.body),o={blocks:e,...r?{preheader:r}:{},...t.title?{title:t.title}:t.heading?{title:t.heading}:{},...t.header?{header:t.header}:{},...t.footer?{footer:t.footer}:{},...t.theme?{theme:t.theme}:{}};return g(o)}function q(t){return(t.split(/\n/).map(r=>r.trim()).find(Boolean)??"").replace(/^#+\s*/,"").slice(0,150)}return I(W);})();
