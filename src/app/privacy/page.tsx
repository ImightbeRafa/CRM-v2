import { POLICY_DATE_EN, POLICY_VERSION, PRIVACY_EMAIL, SUBPROCESSORS } from '@/lib/legal/privacy-content'

export const metadata = { title: 'Privacy Policy — Betsy CRM' }

const h2 = 'text-xl font-semibold text-gray-900 mb-3'
const h3 = 'text-lg font-medium text-gray-900 mb-2 mt-4'
const ul = 'list-disc pl-6 space-y-2'

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto bg-white rounded-lg shadow-md p-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Privacy Policy</h1>
        <p className="text-sm text-gray-500 mb-1">
          Version {POLICY_VERSION} · Last updated: {POLICY_DATE_EN}
        </p>
        <p className="text-sm text-gray-500 mb-6">
          <a href="/privacy/es" className="text-blue-600 hover:underline">Leer en español</a>
        </p>

        <div className="space-y-6 text-gray-700">
          <section>
            <h2 className={h2}>1. Introduction and roles</h2>
            <p>
              Welcome to Betsy CRM (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;). We are committed to protecting personal
              information and your right to privacy. This policy explains what we collect, how we use it, who can process it
              and the choices you have.
            </p>
            <ul className={`${ul} mt-2`}>
              <li>
                <strong>Account data</strong> (the people who sign in to Betsy CRM): Betsy CRM is the <em>controller</em>.
              </li>
              <li>
                <strong>Business data</strong> (a business&apos;s customers, conversations, orders and inventory): the business is
                the <em>controller</em> (&quot;responsable&quot; under Costa Rican law) and Betsy CRM is its <em>processor</em>
                (&quot;encargado&quot;). We process that data only on the business&apos;s instructions and under our data processing
                terms.
              </li>
            </ul>
          </section>

          <section id="commitments">
            <h2 className={h2}>2. Our commitments</h2>
            <ul className={ul}>
              <li><strong>We do not sell personal data.</strong></li>
              <li>
                <strong>We do not use customer data to train or improve AI models</strong> — ours or anyone else&apos;s — and we do
                not allow our AI providers to do so with data we send them.
              </li>
              <li>
                <strong>We do not share data with third parties for their own purposes.</strong> Data is shared only with the
                service providers listed in section 6, strictly to run the service, under contractual confidentiality and
                security obligations.
              </li>
              <li>
                We test and evaluate our AI features with messages written by our own team or by the business itself, never with
                real customer conversations.
              </li>
              <li>
                We work to the standards that apply to us: Costa Rica&apos;s Law 8968 on the Protection of Individuals regarding the
                Processing of Personal Data and its Regulation, Meta&apos;s WhatsApp Business and Instagram platform terms, and
                the principles of the EU GDPR.
              </li>
            </ul>
          </section>

          <section>
            <h2 className={h2}>3. Information we collect</h2>
            <h3 className={h3}>3.1 Information you provide</h3>
            <ul className={ul}>
              <li><strong>Account information:</strong> name, email address, username and password when you create an account</li>
              <li><strong>Business data:</strong> customer information, orders, inventory, invoices and other data you enter into the CRM</li>
              <li><strong>Profile information:</strong> anything you choose to add to your profile</li>
            </ul>
            <h3 className={h3}>3.2 Information from Google Sign-In</h3>
            <p className="mb-2">When you sign in with Google, we collect your email address, name and profile picture, and your Google account ID to link your account.</p>
            <p className="mt-2 text-sm italic">
              We only access basic profile information. We do NOT access your Gmail, Drive, Calendar or any other Google service.
            </p>
            <h3 className={h3}>3.3 Messages from your customers</h3>
            <p>
              When a business connects WhatsApp or Instagram, we receive and store the conversations between the business and its
              customers (text, display name, contact identifiers and media) so the business can manage them. The business is
              responsible for informing its customers and for having their permission to write to them.
            </p>
            <h3 className={h3}>3.4 Automatically collected information</h3>
            <ul className={ul}>
              <li><strong>Usage data:</strong> how you interact with the platform</li>
              <li><strong>Device information:</strong> browser type, operating system, IP address</li>
              <li><strong>Cookies:</strong> for authentication and session management</li>
            </ul>
          </section>

          <section>
            <h2 className={h2}>4. How we use information</h2>
            <ul className={ul}>
              <li>Provide and maintain the CRM service and manage accounts</li>
              <li>Process and store business data (orders, customers, inventory, conversations)</li>
              <li>Generate AI replies and suggestions, only for businesses that have opted in (section 5)</li>
              <li>Send service-related notifications</li>
              <li>Improve the platform&apos;s reliability and usability using aggregated usage statistics, never customer message content</li>
              <li>Ensure security, prevent fraud and abuse, and comply with legal obligations</li>
            </ul>
          </section>

          <section id="ai">
            <h2 className={h2}>5. AI features and your choice</h2>
            <h3 className={h3}>5.1 What they do</h3>
            <ul className={ul}>
              <li>
                <strong>AI agents in the inbox:</strong> can draft or send replies to a business&apos;s customers on WhatsApp and
                Instagram, in the business&apos;s name. New agents start in a mode where a person reviews suggestions; sending
                without review requires an explicit approval by the business.
              </li>
              <li><strong>Internal team assistant and helpers:</strong> tools used by the business&apos;s own staff (for example a Telegram/WhatsApp assistant and an order-paste helper).</li>
            </ul>
            <h3 className={h3}>5.2 Opt-in, per business</h3>
            <p>
              AI agents are <strong>off until the business owner or an administrator accepts the AI terms</strong> inside Betsy CRM
              (Config → Agents). Until then, the inbox AI agents do not run and the Sales customer-paste helper does not use AI, so no customer message is sent to an AI provider from them. The acceptance records who accepted,
              when and which version, and <strong>can be revoked at any time</strong>: agents stop answering and suggesting
              immediately. If we change the AI terms, the business must accept the new version.
            </p>
            <h3 className={h3}>5.3 What is sent to the AI provider</h3>
            <p>
              Only what is needed to write the reply: the text of the message, the customer&apos;s display name, recent conversation
              context and, when relevant, the status of an order. Before sending, the agents mask card, account/IBAN/SINPE and ID numbers they can detect by pattern; detection of every possible format cannot be guaranteed.
              Replies are generated with settings that ask the provider not to store the request for its own use.
            </p>
            <h3 className={h3}>5.4 What AI providers may and may not do</h3>
            <ul className={ul}>
              <li>They process the data only to return the reply we asked for.</li>
              <li>They are not allowed to train or improve their models with it, according to the terms that govern our use of their business APIs.</li>
              <li>They may keep requests for a limited period (up to 30 days according to their published terms) solely for security and abuse prevention, unless a zero-retention agreement applies.</li>
            </ul>
            <h3 className={h3}>5.5 Human oversight and safety</h3>
            <p>
              Staff can review, edit or dismiss suggestions and mark replies as helpful or not. Sensitive situations (payments,
              refunds, requests to talk to a person, photos or voice notes, and anything the agent is unsure about) are handed to a
              person. The AI never confirms payments and never makes legal or financial decisions about individuals.
            </p>
            <h3 className={h3}>5.6 Telling your customers</h3>
            <p>
              Businesses must tell their customers that an AI assistant may answer them and that a person can step in. We provide
              suggested wording below (the business may edit it):
            </p>
            <blockquote className="border-l-4 pl-3 italic my-2">
              This chat is answered by an artificial-intelligence assistant of [BUSINESS NAME] that may reply automatically, and a
              person on our team can step in when you ask. Your messages are processed by technology providers abroad (for example
              the United States) only to reply to you and manage your order; more information and your rights at [policy URL] or
              [business email]. If you prefer to talk to a person, write &quot;agent&quot;.
            </blockquote>
            <p>
              The internal team assistant (Telegram/WhatsApp) is operated by Betsy for the business&apos;s staff and uses an AI
              provider (xAI) to understand staff messages and order text; it is not covered by the per-business AI opt-in and is
              governed by this policy and the Terms.
            </p>
          </section>

          <section id="subprocessors">
            <h2 className={h2}>6. Who can process data (service providers)</h2>
            <p className="mb-3">
              We do not sell personal information. We share it only with these providers, only to operate the service. We will
              update this list before adding a provider that processes customer data, and notify businesses in advance.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm border border-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="p-2 border-b">Provider</th>
                    <th className="p-2 border-b">Purpose</th>
                    <th className="p-2 border-b">Data</th>
                  </tr>
                </thead>
                <tbody>
                  {SUBPROCESSORS.map((p) => (
                    <tr key={p.name} className="align-top">
                      <td className="p-2 border-b font-medium">{p.name}</td>
                      <td className="p-2 border-b">{p.purposeEn}</td>
                      <td className="p-2 border-b">{p.dataEn}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3">Other disclosures: to your own team (data you enter is shared with other users of your business), when required by law or to protect rights and safety, and in a merger or sale of assets (with notice).</p>
          </section>

          <section id="security">
            <h2 className={h2}>7. Data security</h2>
            <ul className={ul}>
              <li>Passwords are hashed with industry-standard algorithms; connections use HTTPS</li>
              <li>Each business&apos;s data is isolated from every other business</li>
              <li>Database access is restricted and monitored; backups are verified with test restores</li>
              <li>Administrative actions that affect agents (for example approvals and emergency stops) are audited</li>
              <li>We have an emergency switch that stops all AI agents at once</li>
            </ul>
          </section>

          <section>
            <h2 className={h2}>8. Your rights and choices</h2>
            <p className="mb-2">You have the right to:</p>
            <ul className={ul}>
              <li><strong>Access</strong> a copy of your personal data</li>
              <li><strong>Rectification:</strong> correct inaccurate information</li>
              <li><strong>Deletion / erasure</strong> of your account and data</li>
              <li><strong>Objection and revocation of consent</strong>, including the AI opt-in, with no retroactive effect</li>
              <li><strong>Export:</strong> receive your data in a portable format</li>
              <li><strong>Revoke Google access</strong> at any time in your Google account settings</li>
            </ul>
            <p className="mt-3">
              Customers of a business should contact that business first; we help the business respond. To exercise your rights
              with us, write to <a href={`mailto:${PRIVACY_EMAIL}`} className="text-blue-600 hover:underline">{PRIVACY_EMAIL}</a>.
              In Costa Rica you can also contact the Agency for the Protection of Individuals&apos; Data (PRODHAB).
            </p>
          </section>

          <section id="instagram-facebook">
            <h2 className={h2}>9. Instagram, Facebook and WhatsApp data</h2>
            <p className="mb-2">When you connect your Instagram Business or WhatsApp Business account, we access and process:</p>
            <h3 className={h3}>9.1 Data we access</h3>
            <ul className={ul}>
              <li><strong>Instagram Business account:</strong> account ID, username, profile information</li>
              <li><strong>Instagram messages:</strong> direct messages to and from your business account</li>
              <li><strong>Facebook Page:</strong> Page ID and page access tokens (required for the Instagram API)</li>
              <li><strong>WhatsApp Business:</strong> phone number ID, business account information and messages</li>
            </ul>
            <h3 className={h3}>9.2 How we use this data</h3>
            <ul className={ul}>
              <li>Display and manage customer conversations inside Betsy CRM</li>
              <li>Send replies on your behalf — by your team, or by an AI agent only if your business opted in (section 5)</li>
              <li>Link conversations to customer profiles and orders</li>
              <li>Show statistics about your own conversations</li>
            </ul>
            <h3 className={h3}>9.3 Retention and deletion</h3>
            <ul className={ul}>
              <li>Messages are stored while you keep the connection</li>
              <li>You can disconnect at any time from Settings → Social Accounts; on disconnection we delete the access tokens; message history stays in the business&apos;s account until the business asks us to delete it or closes its account (then within 30 days)</li>
              <li>You can request full deletion by emailing <a href={`mailto:${PRIVACY_EMAIL}`} className="text-blue-600 hover:underline">{PRIVACY_EMAIL}</a></li>
            </ul>
            <h3 className={h3}>9.4 Data sharing</h3>
            <p>
              We do not sell or share Instagram, Facebook or WhatsApp data for anyone&apos;s own purposes, and we never use it to
              train AI models. It is accessible to you, your authorized team and the service providers in section 6 (including the AI
              providers, only if your business opted in), only to run the service. The only other exception is the optional ad sales
              measurement in 9.5, which a business must turn on itself.
            </p>
            <h3 className={h3}>9.5 Ad sales measurement (optional, off by default)</h3>
            <p>
              When a customer starts a WhatsApp conversation from a Meta ad, Meta includes an ad click identifier in the message.
              Betsy stores it with that conversation so the business can see which ad brought the chat.
            </p>
            <p className="mt-2">
              If the business owner turns on &quot;Ventas por anuncios (Meta)&quot; and accepts the notice, Betsy reports to that
              business&apos;s own Meta account, on its behalf, only when an order from that conversation is paid: the ad click
              identifier, the business&apos;s WhatsApp Business account identifier, the amount and the currency. Betsy never sends
              names, phone numbers, email addresses or message content for this purpose. The business is the controller of this data
              and is responsible for informing its customers; Betsy acts as its processor. Ad click identifiers are deleted after 90
              days, and the business can turn the feature off at any time.
            </p>
          </section>

          <section>
            <h2 className={h2}>10. Google OAuth disclosure</h2>
            <p className="mb-2">Our use of Google user data is limited to authenticating your identity and retrieving your basic profile (name, email, picture).</p>
            <p>
              We do NOT access your Gmail, Drive, Calendar or any other Google service. You can revoke access at any time on your
              <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline ml-1">Google Account Permissions page</a>.
            </p>
          </section>

          <section id="retention">
            <h2 className={h2}>11. Data retention</h2>
            <ul className={ul}>
              <li><strong>Account and business data:</strong> while the account is active; when you delete the account we delete personal data within 30 days, except what the law requires us to keep</li>
              <li><strong>Conversation messages:</strong> kept while the account is active; deleted within 30 days of the business&apos;s deletion request or account closure</li>
              <li><strong>AI reply text and its technical trace kept for review:</strong> 90 days, then removed (counts and cost metadata are kept for statistics)</li>
              <li><strong>Ad click identifiers:</strong> 90 days</li>
              <li><strong>Backups:</strong> deleted within 90 days</li>
              <li><strong>AI providers:</strong> up to 30 days for abuse prevention, per their terms, unless zero retention applies</li>
            </ul>
          </section>

          <section>
            <h2 className={h2}>12. International data transfers</h2>
            <p>
              Our providers (including the AI providers) may process data outside Costa Rica, including in the United States. We
              require contractual confidentiality and security measures comparable to those required by Law 8968 and its
              Regulation, and we inform businesses of these transfers so they can inform their customers.
            </p>
          </section>

          <section>
            <h2 className={h2}>13. Children&apos;s privacy</h2>
            <p>Our service is not intended for children under 13. We do not knowingly collect their personal information. If you believe a child has provided us with personal information, contact us immediately.</p>
          </section>

          <section>
            <h2 className={h2}>14. Changes to this policy</h2>
            <p>
              We may update this policy. We will notify you of significant changes by email or in the platform, and changes to the AI
              terms require each business to accept the new version before its AI agents keep running. The version and date at the top
              identify the current text.
            </p>
          </section>

          <section>
            <h2 className={h2}>15. Contact</h2>
            <ul className="list-none space-y-2">
              <li><strong>Email:</strong> <a href={`mailto:${PRIVACY_EMAIL}`} className="text-blue-600 hover:underline">{PRIVACY_EMAIL}</a></li>
              <li><strong>Website:</strong> <a href="https://www.betsycrm.com" className="text-blue-600 hover:underline">www.betsycrm.com</a></li>
            </ul>
          </section>

          <section id="gdpr" className="border-t pt-6 mt-8">
            <h2 className={h2}>GDPR (EU users)</h2>
            <p>If you are in the European Economic Area, you also have these rights under the GDPR:</p>
            <ul className={`${ul} mt-2`}>
              <li><strong>Legal basis:</strong> contract performance and legitimate interests; consent where we ask for it (for example the AI opt-in)</li>
              <li><strong>Roles:</strong> Betsy CRM is the controller of account data and a processor of a business&apos;s customer data</li>
              <li><strong>Right to complain</strong> to your local data protection authority</li>
              <li><strong>Portability</strong> in a structured, machine-readable format</li>
            </ul>
          </section>
        </div>

        <div className="mt-8 pt-6 border-t">
          <a href="/dashboard" className="text-blue-600 hover:underline">← Back to Home</a>
        </div>
      </div>
      <footer className="mt-8 text-center text-gray-500 text-sm">
        © {new Date().getFullYear()} Rafael Garcia Montoya. All rights reserved.
      </footer>
    </div>
  )
}
