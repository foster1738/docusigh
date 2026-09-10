"use strict";var Bulletproof=(()=>{var f=Object.defineProperty;var T=Object.getOwnPropertyDescriptor;var v=Object.getOwnPropertyNames;var I=Object.prototype.hasOwnProperty;var B=(e,t)=>{for(var r in t)f(e,r,{get:t[r],enumerable:!0})},U=(e,t,r,o)=>{if(t&&typeof t=="object"||typeof t=="function")for(let n of v(t))!I.call(e,n)&&n!==r&&f(e,n,{get:()=>t[n],enumerable:!(o=T(t,n))||o.enumerable});return e};var z=e=>U(f({},"__esModule",{value:!0}),e);var O={};B(O,{DEFAULT_THEME:()=>d,escapeHtml:()=>a,inlineFormat:()=>p,renderBulletproofEmail:()=>g,renderSigningCompleted:()=>b,renderSigningInvitation:()=>x,renderText:()=>u,safeColor:()=>c,safeUrl:()=>s});var F={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"};function a(e){return e.replace(/[&<>"']/g,t=>F[t]??t)}function s(e){let r=e.trim().replace(/[\u0000-\u0020\u007f-\u00a0]/g,"");return/^(https?:|mailto:)/i.test(r)?a(r):/^[a-z][a-z0-9+.-]*:/i.test(r)?"#":a(r)}function c(e,t){let r=e.trim();return/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(r)||/^rgba?\(\s*[\d.\s,%/]+\)$/i.test(r)||/^[a-z]{1,20}$/i.test(r)?r:t}var d={brandColor:"#2563eb",backgroundColor:"#f4f4f7",cardColor:"#ffffff",textColor:"#333333",mutedColor:"#6b7280",buttonTextColor:"#ffffff",fontFamily:"-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji'",width:600,borderRadius:8};function g(e){let t=H(e.theme),r=q(e.lang??"en","en"),o=e.dir==="rtl"?"rtl":"ltr",n=Math.max(320,Math.min(800,Math.round(t.width))),i=a(e.title??e.header?.name??""),l=e.preheader?A(e.preheader):"",y=e.header?M(e.header,t,n):"",$=e.blocks.map(k=>R(k,t,n)).join(`
`),w=e.footer?L(e.footer,t):"",E=N({lang:r,dir:o,title:i,theme:t,width:n,preheader:l,header:y,body:$,footer:w}),C=u(e);return{html:E,text:C}}function H(e){let t={...d,...e};return{brandColor:c(t.brandColor,d.brandColor),backgroundColor:c(t.backgroundColor,d.backgroundColor),cardColor:c(t.cardColor,d.cardColor),textColor:c(t.textColor,d.textColor),mutedColor:c(t.mutedColor,d.mutedColor),buttonTextColor:c(t.buttonTextColor,d.buttonTextColor),fontFamily:t.fontFamily,width:t.width,borderRadius:Math.max(0,Math.min(40,Math.round(t.borderRadius)))}}function N(e){let{theme:t,width:r}=e,o=m(t.fontFamily);return`<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "https://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" lang="${e.lang}" dir="${e.dir}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no" />
<title>${e.title}</title>
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
  .es-btn a { color: ${t.buttonTextColor}; }
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
<body class="es-body" style="margin:0;padding:0;width:100%;background:${t.backgroundColor};-webkit-font-smoothing:antialiased;">
${e.preheader}
<div role="article" aria-roledescription="email" aria-label="${e.title}" lang="${e.lang}" dir="${e.dir}" style="background:${t.backgroundColor};">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${t.backgroundColor};">
<tr><td align="center" style="padding:24px 12px;">
<!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" width="${r}" align="center"><tr><td><![endif]-->
<table role="presentation" class="es-container" cellpadding="0" cellspacing="0" width="${r}" style="width:${r}px;max-width:${r}px;margin:0 auto;">
${e.header}
<tr><td class="es-card es-pad" style="background:${t.cardColor};border-radius:${t.borderRadius}px;padding:40px;font-family:${o};">
${e.body}
</td></tr>
${e.footer}
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</div>
</body>
</html>`}function A(e){let t="&#847;&zwnj;&nbsp;".repeat(60);return`<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${a(e)}${t}</div>`}function M(e,t,r){let o=m(t.fontFamily),n;if(e.logoUrl){let i=e.logoWidth??160,l=`<img src="${s(e.logoUrl)}" alt="${m(e.name)}" width="${i}" style="display:block;border:0;outline:none;text-decoration:none;height:auto;max-width:${i}px;" />`;n=e.href?`<a href="${s(e.href)}" target="_blank">${l}</a>`:l}else{let i=`<span style="font-family:${o};font-size:22px;font-weight:700;color:${t.brandColor};">${a(e.name)}</span>`;n=e.href?`<a href="${s(e.href)}" target="_blank" style="text-decoration:none;">${i}</a>`:i}return`<tr><td class="es-pad" align="center" style="padding:8px 40px 24px;">${n}</td></tr>`}function R(e,t,r){switch(e.type){case"heading":return S(e.text,e.level??1,t);case"text":return D(e.text,t,e.muted??!1,e.align??"left");case"html":return`<div class="es-text" style="color:${t.textColor};font-size:16px;line-height:24px;">${e.trustedHtml}</div>`;case"button":return P(e.text,e.url,t);case"image":return j(e,r);case"divider":return'<table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr><td style="padding:24px 0;"><div class="es-divider" style="border-top:1px solid #e5e7eb;font-size:0;line-height:0;">&nbsp;</div></td></tr></table>';case"spacer":{let o=Math.max(1,Math.min(120,Math.round(e.height??24)));return`<div style="line-height:${o}px;height:${o}px;font-size:1px;">&nbsp;</div>`}case"callout":return _(e.text,t);default:return""}}function S(e,t,r){let o={1:[28,34],2:[22,28],3:[18,24]},[n,i]=o[t],l=m(r.fontFamily);return`<h${t} class="es-h${t}" style="margin:0 0 16px;font-family:${l};font-size:${n}px;line-height:${i}px;font-weight:700;color:${r.textColor};">${p(e,r)}</h${t}>`}function D(e,t,r,o){let n=r?t.mutedColor:t.textColor,i=r?"es-muted":"es-text",l=o==="center"||o==="right"?o:"left";return`<p class="${i}" style="margin:0 0 16px;font-family:${m(t.fontFamily)};font-size:16px;line-height:24px;color:${n};text-align:${l};">${p(e,t)}</p>`}function P(e,t,r){let o=s(t),n=a(e),i=m(r.fontFamily),l=r.borderRadius;return`<table role="presentation" class="es-btn" cellpadding="0" cellspacing="0" width="100%" style="margin:8px 0 24px;"><tr><td align="center">
<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${o}" style="height:48px;v-text-anchor:middle;width:280px;" arcsize="${Math.round(l/24*100)}%" strokecolor="${r.brandColor}" fillcolor="${r.brandColor}">
<w:anchorlock/>
<center style="color:${r.buttonTextColor};font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">${n}</center>
</v:roundrect>
<![endif]-->
<!--[if !mso]><!-- -->
<a href="${o}" target="_blank" style="background:${r.brandColor};border-radius:${l}px;color:${r.buttonTextColor};display:inline-block;font-family:${i};font-size:16px;font-weight:bold;line-height:48px;text-align:center;text-decoration:none;width:280px;-webkit-text-size-adjust:none;mso-hide:all;">${n}</a>
<!--<![endif]-->
</td></tr></table>`}function j(e,t){let r=Math.min(e.width??t-80,t),o=`<img src="${s(e.src)}" alt="${m(e.alt)}" width="${r}" style="display:block;border:0;outline:none;text-decoration:none;height:auto;max-width:100%;margin:0 auto;" />`;return`<table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr><td align="center" style="padding:8px 0 24px;">${e.href?`<a href="${s(e.href)}" target="_blank">${o}</a>`:o}</td></tr></table>`}function _(e,t){return`<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;"><tr><td class="es-callout" style="background:#f3f4f6;border-left:4px solid ${t.brandColor};border-radius:4px;padding:16px 20px;font-family:${m(t.fontFamily)};font-size:15px;line-height:22px;color:${t.textColor};">${p(e,t)}</td></tr></table>`}function L(e,t){let r=m(t.fontFamily),o=[];for(let n of e.lines??[])o.push(a(n));if(e.address&&o.push(a(e.address)),e.unsubscribeUrl){let n=a(e.unsubscribeText??"Unsubscribe");o.push(`<a href="${s(e.unsubscribeUrl)}" target="_blank" style="color:${t.mutedColor};text-decoration:underline;">${n}</a>`)}return o.length===0?"":`<tr><td class="es-pad" align="center" style="padding:24px 40px;font-family:${r};font-size:12px;line-height:18px;color:${t.mutedColor};" class="es-muted">${o.join("<br />")}</td></tr>`}function p(e,t){let r=a(e);return r=r.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,(o,n,i)=>`<a href="${s(i)}" target="_blank" style="color:${t.brandColor};text-decoration:underline;">${n}</a>`),r=r.replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>"),r=r.replace(/(^|[^*])\*([^*]+)\*/g,"$1<em>$2</em>"),r=r.replace(/\n/g,"<br />"),r}function u(e){let t=[];e.preheader&&t.push(e.preheader,""),e.header?.name&&t.push(e.header.name.toUpperCase(),"");for(let o of e.blocks)switch(o.type){case"heading":t.push(h(o.text),"");break;case"text":case"callout":t.push(h(o.text),"");break;case"button":t.push(`${h(o.text)}: ${o.url}`,"");break;case"image":o.href?t.push(`${o.alt}: ${o.href}`,""):o.alt&&t.push(`[${o.alt}]`,"");break;case"divider":t.push("----------------------------------------","");break;case"html":t.push(o.trustedHtml.replace(/<[^>]+>/g,"").trim(),"");break;case"spacer":break}let r=[];for(let o of e.footer?.lines??[])r.push(o);return e.footer?.address&&r.push(e.footer.address),e.footer?.unsubscribeUrl&&r.push(`${e.footer.unsubscribeText??"Unsubscribe"}: ${e.footer.unsubscribeUrl}`),r.length&&t.push("--",...r),t.join(`
`).replace(/\n{3,}/g,`

`).trim()+`
`}function h(e){return e.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,"$1 ($2)").replace(/\*\*([^*]+)\*\*/g,"$1").replace(/\*([^*]+)\*/g,"$1")}function m(e){return a(e)}function q(e,t){return/^[a-z]{2}(-[a-z0-9]{2,8})*$/i.test(e.trim())?e.trim():t}function x(e){let t=e.signerName?`Hi ${e.signerName},`:"Hello,",r=[{type:"heading",text:`${e.senderName} has requested your signature`},{type:"text",text:t},{type:"text",text:`Please review and sign **${e.documentName}**. It only takes a minute, and you can sign from any device.`}];e.message&&r.push({type:"callout",text:e.message}),r.push({type:"button",text:"Review & Sign Document",url:e.signUrl}),e.expiresAt&&r.push({type:"text",text:`This request expires on ${e.expiresAt}.`,muted:!0}),r.push({type:"text",text:"If the button above does not work, copy and paste this link into your browser:",muted:!0}),r.push({type:"text",text:`[${e.signUrl}](${e.signUrl})`,muted:!0});let o={preheader:`${e.senderName} has requested your signature on ${e.documentName}.`,title:`Signature requested: ${e.documentName}`,blocks:r,...e.header?{header:e.header}:{header:{name:e.senderName}},...e.footer?{footer:e.footer}:{},...e.theme?{theme:e.theme}:{}};return g(o)}function b(e){let t=[{type:"heading",text:"Your document is fully signed"},{type:"text",text:e.signerName?`Hi ${e.signerName},`:"Hello,"},{type:"text",text:`Good news \u2014 **${e.documentName}** has been signed by all parties${e.completedAt?` on ${e.completedAt}`:""}. A copy is attached, and you can also download it below.`},{type:"button",text:"Download Signed Document",url:e.downloadUrl}],r={preheader:`${e.documentName} has been completed and signed by all parties.`,title:`Completed: ${e.documentName}`,blocks:t,...e.header?{header:e.header}:{},...e.footer?{footer:e.footer}:{},...e.theme?{theme:e.theme}:{}};return g(r)}return z(O);})();
