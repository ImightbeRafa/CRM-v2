import Link from 'next/link'
import type { ReactNode } from 'react'

/** Fixed date of the current text. Change it (and the version) whenever the policy changes. */
const PRIVACY_POLICY_VERSION = '2026-10-22'
const PRIVACY_POLICY_UPDATED = 'October 22, 2026'

type ProviderRow = { name: string; purpose: string; data: string; region: string }

/** Every outside company that processes personal data for Betsy. Keep in sync with the code. */
const SUB_PROCESSORS: ProviderRow[] = [
  {
    name: 'Supabase (on Amazon Web Services)',
    purpose: 'Main database and private file storage for chat media',
    data: 'All account, business, conversation and media data',
    region: 'United States (AWS us-east-1)',
  },
  {
    name: 'Cloudflare',
    purpose: 'Hosting of the app (Workers and Containers), network protection, Turnstile bot check, private backups (R2)',
    data: 'All data in transit; full database backups',
    region: 'Global network; backups in the United States',
  },
  {
    name: 'Railway',
    purpose: 'Test (preview) copy of the app, connected to the same database',
    data: 'Same data as the main app when the test copy is used',
    region: 'United States',
  },
  {
    name: 'OpenAI',
    purpose: 'AI features described in section 4 (only when they are used or turned on)',
    data: 'Message text and context, files the business uploads, staff assistant messages and voice notes',
    region: 'United States',
  },
  {
    name: 'Upstash',
    purpose: 'Rate-limit counters, short-lived connection steps, staff assistant short-term memory',
    data: 'IP addresses and user ids (counters), staff assistant messages (up to 7 days)',
    region: 'United States',
  },
  {
    name: 'Resend',
    purpose: 'Service emails (verification, password reset, notices)',
    data: 'Email address, name, email content',
    region: 'United States',
  },
  {
    name: 'Tilopay',
    purpose: 'Payment of the Betsy subscription',
    data: 'Billing name, email, amount (card details are entered on Tilopay and never stored by Betsy)',
    region: 'Costa Rica',
  },
  {
    name: 'Correos de Costa Rica',
    purpose: 'Shipping labels and tracking, when the business ships with Correos',
    data: 'Recipient name, phone number and delivery address',
    region: 'Costa Rica',
  },
  {
    name: 'Telegram',
    purpose: 'Staff assistant for the business’s own team, if the business uses it on Telegram',
    data: 'Messages between the team member and the assistant',
    region: 'Global (Telegram data centers)',
  },
  {
    name: 'Google',
    purpose: 'Sign in with Google',
    data: 'Name, email address, profile picture, Google account id',
    region: 'United States',
  },
  {
    name: 'Meta Platforms (Instagram, Facebook, WhatsApp)',
    purpose: 'Receiving and sending the business’s messages; optional ad sales measurement (section 5)',
    data: 'Message content, account ids; for measurement only the ids and amounts listed in section 5',
    region: 'United States and Ireland',
  },
]

type RetentionRow = { item: string; period: string }

const RETENTION: RetentionRow[] = [
  { item: 'Instagram, Facebook and WhatsApp access tokens', period: 'Deleted immediately when the business disconnects the account in Betsy or removes Betsy in its Facebook or Instagram settings.' },
  { item: 'Conversations, messages and chat media (photos, voice notes, videos, documents)', period: 'Kept for the business while its Betsy account exists, including after a channel is disconnected, so it does not lose its history. Deleted by a deletion request (section 8) or an account erase.' },
  { item: 'AI agent outputs (drafted replies, suggestions, decision records)', period: '90 days, then deleted automatically.' },
  { item: 'Ad click identifier (WhatsApp “ctwa_clid”)', period: '90 days, then deleted automatically.' },
  { item: 'Staff assistant short-term memory', period: 'Up to 7 days, then deleted automatically.' },
  { item: 'In-app notifications', period: '90 days once read, 180 days if unread.' },
  { item: 'Activity history inside the workspace', period: '395 days.' },
  { item: 'Security logs (sign-ins, IP addresses)', period: 'Kept while the account exists, to investigate abuse; deleted with an account erase.' },
  { item: 'Backups', period: 'Private full copies of the database, kept for 14 days and then overwritten.' },
  { item: 'Data held by OpenAI for the API', period: 'Up to 30 days, only for abuse and security monitoring (OpenAI’s API policy).' },
]

function Section({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <section id={id}>
      <h2 className="text-xl font-semibold text-gray-900 mb-3">{title}</h2>
      {children}
    </section>
  )
}

function Sub({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <h3 className="text-lg font-medium text-gray-900 mb-2 mt-4">{title}</h3>
      {children}
    </>
  )
}

const mail = (address: string) => (
  <a href={`mailto:${address}`} className="text-blue-600 hover:underline">
    {address}
  </a>
)

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto bg-white rounded-lg shadow-md p-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-6">Privacy Policy</h1>

        <p className="text-sm text-gray-500 mb-6">
          Last updated: {PRIVACY_POLICY_UPDATED} · Version {PRIVACY_POLICY_VERSION}
        </p>

        <div className="space-y-6 text-gray-700">
          <Section title="1. Who we are and our role">
            <p>
              Betsy CRM (&quot;Betsy&quot;, &quot;we&quot;) is a sales and customer-service platform for businesses, operated
              from Costa Rica by Rafael Garcia Montoya. This policy explains what we collect, why, who processes it,
              how long we keep it and how to delete it.
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-2">
              <li>
                <strong>Account data</strong> (the people who use Betsy): Betsy decides how it is used and is responsible
                for it.
              </li>
              <li>
                <strong>Customer data</strong> (the business&apos;s customers, their messages and orders): the business is
                responsible for it. Betsy processes it only to provide the service, on the business&apos;s instructions.
              </li>
            </ul>
          </Section>

          <Section title="2. Information we collect">
            <Sub title="2.1 Account information">
              <ul className="list-disc pl-6 space-y-2">
                <li>Name, email address, username and password (stored only as a bcrypt hash).</li>
                <li>Phone number, if you verify one.</li>
                <li>
                  With Google sign-in: your Google name, email address, profile picture and Google account id. We do not
                  access Gmail, Drive, Calendar or any other Google service.
                </li>
              </ul>
            </Sub>
            <Sub title="2.2 Business data you enter">
              <p>Customers, orders, products, inventory, invoices, deliveries, notes and tasks you create in Betsy.</p>
            </Sub>
            <Sub title="2.3 Connected Instagram, Facebook and WhatsApp accounts">
              <ul className="list-disc pl-6 space-y-2">
                <li>
                  Instagram professional account id, username, name and profile picture; the linked Facebook Page id; the
                  id of the Facebook user who connected it.
                </li>
                <li>WhatsApp Business account id, phone number id and display phone number.</li>
                <li>Access tokens Meta gives us for these accounts, stored encrypted.</li>
              </ul>
            </Sub>
            <Sub title="2.4 Customer conversations received through those accounts">
              <ul className="list-disc pl-6 space-y-2">
                <li>
                  Messages and what they contain: text, photos, voice notes, videos, documents and stickers, sent and
                  received, with their time.
                </li>
                <li>
                  The customer&apos;s name, username and profile picture as shown by Instagram or WhatsApp, their
                  Instagram-scoped id or WhatsApp phone number.
                </li>
                <li>
                  When a conversation starts from a Facebook or Instagram ad: the ad id, the ad&apos;s headline and text,
                  its link and, on WhatsApp, the ad click identifier (&quot;ctwa_clid&quot;).
                </li>
              </ul>
            </Sub>
            <Sub title="2.5 Technical information">
              <ul className="list-disc pl-6 space-y-2">
                <li>IP address and browser, in security logs and rate-limit counters.</li>
                <li>Cookies only for signing in and keeping your session. Cloudflare Turnstile checks sign-up forms for bots.</li>
                <li>We use no analytics, advertising trackers or third-party advertising cookies.</li>
              </ul>
            </Sub>
          </Section>

          <Section title="3. How we use information">
            <ul className="list-disc pl-6 space-y-2">
              <li>Provide the CRM: show and answer conversations, link them to customers and orders, run deliveries and billing.</li>
              <li>Send replies on the business&apos;s behalf, written by its team or by its AI agent if it turned one on.</li>
              <li>Show the business which ad brought a conversation and, if it turns it on, measure ad sales (section 5).</li>
              <li>Send service emails, keep the service secure and prevent abuse, and meet legal duties.</li>
            </ul>
            <p className="mt-2">
              We do not sell personal data. We do not use Instagram, Facebook or WhatsApp data for advertising, profiling or
              any purpose other than providing Betsy to the business that connected the account. We do not use it to train
              AI models.
            </p>
          </Section>

          <Section id="ai" title="4. AI features (OpenAI)">
            <p>Betsy uses OpenAI&apos;s API for the features below. OpenAI does not use API data to train its models and may keep it for up to 30 days only for abuse and security monitoring. For the inbox agent, the payment check and the order helper, card, bank-account and ID numbers are masked before text is sent, as far as we can detect them.</p>
            <ul className="list-disc pl-6 space-y-2 mt-2">
              <li>
                <strong>Inbox AI agent (off until the business turns it on).</strong> The business owner must accept AI
                terms and turn on each agent. While an agent is on, the customer&apos;s message text, their display name,
                recent conversation text and, when relevant, the status of their order are sent to OpenAI to write the
                reply and to check whether the customer says they have paid (the payment check). The agent does not send
                customer photos, voice notes, videos or documents to OpenAI; it sees only that a file arrived.
              </li>
              <li>
                <strong>Agent knowledge.</strong> Product photos, documents, web pages and saved replies that the business
                uploads to set up an agent are sent to OpenAI to read them (including image reading).
              </li>
              <li>
                <strong>Order helper.</strong> Text a team member pastes into the order form is sent to OpenAI to fill in the
                fields, when the business has accepted the AI terms.
              </li>
              <li>
                <strong>Staff assistant.</strong> If the business uses Betsy&apos;s assistant for its own team (on Telegram or
                WhatsApp), the team member&apos;s messages and voice notes (transcribed by OpenAI) and the order and customer
                data the assistant looks up are sent to OpenAI to answer.
              </li>
            </ul>
          </Section>

          <Section id="ad-measurement" title="5. Ad sales measurement with Meta (optional, off by default)">
            <p>
              When a customer starts a WhatsApp or Instagram conversation from a Facebook or Instagram ad, Meta tells us which
              ad it was. Betsy stores this with the conversation so the business can see which ad brought the chat.
            </p>
            <p className="mt-2">
              If the business owner turns on &quot;Ventas por anuncios (Meta)&quot; and accepts the notice, Betsy reports a
              purchase to the business&apos;s own Meta dataset, on the business&apos;s behalf, only when an order from a
              conversation that came from an ad within the previous 7 days is marked paid. Each report contains only:
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-2">
              <li>
                <strong>WhatsApp:</strong> the business&apos;s WhatsApp Business account id and the ad click identifier
                (ctwa_clid).
              </li>
              <li>
                <strong>Instagram:</strong> the business&apos;s Instagram account id and the customer&apos;s Instagram-scoped
                id (IGSID), an id Meta itself created for that conversation.
              </li>
              <li>The order&apos;s amount, currency and time.</li>
            </ul>
            <p className="mt-2">
              Betsy never sends names, phone numbers, email addresses, addresses or message content for this. The business is
              responsible for informing its customers; Betsy acts on its behalf. Ad click identifiers are deleted from Betsy
              after 90 days. The business can turn the feature off at any time, and reports stop at once.
            </p>
          </Section>

          <Section id="sub-processors" title="6. Who processes data for us (sub-processors)">
            <p className="mb-3">
              We share data only with the companies below, only for the purpose shown, and with the business&apos;s own team
              members inside its workspace. We may also disclose data when the law requires it.
            </p>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm border border-gray-200">
                <thead className="bg-gray-50 text-left">
                  <tr>
                    <th className="p-2 border-b">Company</th>
                    <th className="p-2 border-b">Purpose</th>
                    <th className="p-2 border-b">Data</th>
                    <th className="p-2 border-b">Region</th>
                  </tr>
                </thead>
                <tbody>
                  {SUB_PROCESSORS.map((row) => (
                    <tr key={row.name} className="align-top">
                      <td className="p-2 border-b font-medium">{row.name}</td>
                      <td className="p-2 border-b">{row.purpose}</td>
                      <td className="p-2 border-b">{row.data}</td>
                      <td className="p-2 border-b">{row.region}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section id="retention" title="7. How long we keep data">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm border border-gray-200">
                <thead className="bg-gray-50 text-left">
                  <tr>
                    <th className="p-2 border-b">Data</th>
                    <th className="p-2 border-b">How long</th>
                  </tr>
                </thead>
                <tbody>
                  {RETENTION.map((row) => (
                    <tr key={row.item} className="align-top">
                      <td className="p-2 border-b font-medium">{row.item}</td>
                      <td className="p-2 border-b">{row.period}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section id="instagram-facebook" title="8. Disconnecting versus deleting">
            <Sub title="8.1 Disconnecting an account">
              <p>
                In Betsy (Configuración › Cuentas conectadas → Desvincular), or by removing Betsy from your Facebook or Instagram settings
                (&quot;Business integrations&quot; / &quot;Apps and websites&quot;): we delete the access tokens immediately and
                stop receiving and sending messages. The conversation history stays in the business&apos;s workspace.
              </p>
            </Sub>
            <Sub title="8.2 Asking us to delete the data">
              <p>
                When you remove Betsy in your Facebook or Instagram settings and ask for your data to be deleted, Meta sends us
                the request. Every Instagram or WhatsApp account you connected with that Facebook user is disconnected at
                once, and the business owner is told by email. 3 days later (at the first nightly run after that) we delete
                all conversations, messages, media files, ad referrals and AI records received through those accounts. The
                wait lets the business react if, for example, you were one of several admins; if the business connects the
                account again in that time, our team reviews the request by hand and completes it within 30 days. The
                business keeps its own setup and the orders and customer records its team created. If a file cannot be
                deleted at once, we retry automatically every night. You get a confirmation code and a status page at{' '}
                <Link href="/data-deletion" className="text-blue-600 hover:underline">
                  betsycrm.com/data-deletion
                </Link>
                . If we cannot match the request to an account automatically, the status page says so and we complete it by
                hand within 30 days when you email us. Backups roll over within 14 days. You can also ask by email at{' '}
                {mail('hola@betsycrm.com')}.
              </p>
            </Sub>
            <Sub title="8.3 Erasing a whole Betsy account">
              <p>
                The account owner can ask {mail('hola@betsycrm.com')} from the account&apos;s email address to erase the
                whole workspace (users, customers, orders, conversations, media and logs). We do it by hand within 30 days and
                confirm by email; backups roll over within 14 more days.
              </p>
            </Sub>
            <Sub title="8.4 If you are a customer of a business that uses Betsy">
              <p>
                Contact the business first, since it is responsible for your data. You can also write to{' '}
                {mail('hola@betsycrm.com')}; we will help the business answer or act on your request.
              </p>
            </Sub>
          </Section>

          <Section title="9. Your rights">
            <p className="mb-2">
              You can ask to access, correct, export or delete your personal data, or object to its use, by writing to{' '}
              {mail('hola@betsycrm.com')}. We answer within 10 business days. In Costa Rica you can also contact PRODHAB,
              and in the European Economic Area your local data protection authority.
            </p>
            <p>
              You can revoke Google access at any time on your{' '}
              <a
                href="https://myaccount.google.com/permissions"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline"
              >
                Google Account permissions page
              </a>
              .
            </p>
          </Section>

          <Section title="10. International transfers">
            <p>
              Betsy&apos;s data is stored in the United States (Supabase on AWS us-east-1, with backups on Cloudflare) and is
              processed by the providers in section 6, most of them in the United States. If you are in Costa Rica or anywhere
              else outside the United States, your data is transferred there. We use providers bound by contracts to protect
              it and to use it only for the service.
            </p>
          </Section>

          <Section id="security" title="11. Security">
            <ul className="list-disc pl-6 space-y-2">
              <li>HTTPS for all traffic; passwords hashed with bcrypt; Meta access tokens encrypted at rest.</li>
              <li>Each business&apos;s data is separated from every other business&apos;s; database and file storage are private.</li>
              <li>Access by our team is limited to what is needed to run and support the service.</li>
            </ul>
          </Section>

          <Section title="12. Children">
            <p>
              Betsy is a tool for businesses and is not meant for children under 13. We do not knowingly collect their data;
              if you believe a child has given us data, contact us and we will delete it.
            </p>
          </Section>

          <Section title="13. Changes to this policy">
            <p>
              When we change this policy we update the date and version above and, for important changes, tell account owners
              by email or inside Betsy before the change applies.
            </p>
          </Section>

          <Section title="14. Contact">
            <ul className="list-none space-y-2">
              <li>
                <strong>Privacy and deletion:</strong> {mail('hola@betsycrm.com')}
              </li>
              <li>
                <strong>Other privacy questions:</strong> {mail('hola@betsycrm.com')}
              </li>
              <li>
                <strong>Website:</strong>{' '}
                <a href="https://www.betsycrm.com" className="text-blue-600 hover:underline">
                  www.betsycrm.com
                </a>
              </li>
            </ul>
          </Section>
        </div>

        <div className="mt-8 pt-6 border-t">
          <Link href="/" className="text-blue-600 hover:underline">
            ← Back to Betsy CRM
          </Link>
        </div>
      </div>

      <footer className="mt-8 text-center text-gray-500 text-sm">© 2026 Rafael Garcia Montoya. All rights reserved.</footer>
    </div>
  )
}
