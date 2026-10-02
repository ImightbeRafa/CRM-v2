'use client';

import Script from 'next/script';

const META_PIXEL_ID = '837653306013618';

declare global {
  interface Window {
    fbq: ((...args: any[]) => void) & { callMethod?: (...args: any[]) => void; queue: any[]; loaded: boolean; version: string; push: (...args: any[]) => void };
    _fbq: typeof window.fbq;
  }
}

export function trackMetaEvent(eventName: string, params?: Record<string, any>): void {
  if (typeof window !== 'undefined' && window.fbq) {
    window.fbq('track', eventName, params);
  }
}

export default function MetaPixel() {
  return (
    <>
      <Script id="meta-pixel" strategy="afterInteractive">
        {`
          // One-time tokens (reset / verification / invite links, also URL-encoded inside
          // callbackUrl) must never reach Meta: no pixel on such a page (INT-01).
          (function () {
          if (/(?:[?&#]|%3F|%26|%23)(?:token|code)(?:=|%3D)/i.test(window.location.href)) { return; }
          !function(f,b,e,v,n,t,s)
          {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
          n.callMethod.apply(n,arguments):n.queue.push(arguments)};
          if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
          n.queue=[];t=b.createElement(e);t.async=!0;
          t.src=v;s=b.getElementsByTagName(e)[0];
          s.parentNode.insertBefore(t,s)}(window, document,'script',
          'https://connect.facebook.net/en_US/fbevents.js');
          // No automatic pageviews on client-side navigation (a later URL could carry a token).
          fbq.disablePushState = true;
          fbq('init', '${META_PIXEL_ID}');
          fbq('track', 'PageView');
          })();
        `}
      </Script>
      <noscript>
        {/* Meta pixel fallback: must be a plain <img> inside <noscript> (no JS, no next/image). */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          height="1"
          width="1"
          style={{ display: 'none' }}
          src={`https://www.facebook.com/tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1`}
          alt=""
        />
      </noscript>
    </>
  );
}
