import type { Metadata } from "next";
import Link from "next/link";

import { appName } from "@/lib/app-metadata";

import styles from "./privacy.module.css";

/**
 * Публичная Datenschutzerklärung (docs/architecture/15-compliance-gdpr.md, §12.4).
 *
 * Страница доступна без входа — `/privacy` в `unauthenticatedPaths`
 * (`lib/db/proxy.ts`). Текст на немецком: рынок запуска — Германия.
 * Содержание опирается на §12.2 (субпроцессоры) и §12.3 (технические меры);
 * при изменении списка субпроцессоров или ретенции обновлять и эту страницу.
 * Перед публичным запуском текст должен проверить юрист по Datenschutz.
 */

const controller = {
  name: "Drafta Software",
  address: ["", "91154", "Roth"],
  email: "info@drafta.online",
};

const lastUpdated = "11. September 2026";

export const metadata: Metadata = {
  title: `Datenschutzerklärung · ${appName}`,
  description: `Informationen zur Verarbeitung personenbezogener Daten in ${appName}.`,
};

const processors = [
  {
    name: "Supabase",
    purpose: "Datenbank, Anmeldung, Dateispeicher",
    data: "Alle in drafta gespeicherten Daten",
    location: "Frankfurt am Main (EU)",
  },
  {
    name: "Vercel",
    purpose: "Hosting und Ausführung der Anwendung",
    data: "Verbindungsdaten, Server-Protokolle",
    location: "Serverfunktionen in Frankfurt (EU); Anbieter mit Sitz in den USA",
  },
  {
    name: "Zernio",
    purpose: "Anbindung der Messenger- und Social-Media-Kanäle",
    data: "Nachrichten und Kommentare (Durchleitung)",
    location: "Verarbeitung in den USA möglich",
  },
  {
    name: "Inngest",
    purpose: "Steuerung von Hintergrundaufgaben",
    data: "Ausschließlich technische Kennungen (IDs), keine Inhalte",
    location: "USA",
  },
  {
    name: "Postmark",
    purpose: "Versand von System-E-Mails",
    data: "E-Mail-Adressen der Nutzer",
    location: "USA",
  },
  {
    name: "Mistral AI",
    purpose: "KI-Antwortentwürfe und Übersetzungen",
    data: "Maskierte Gesprächsinhalte, Wissensdatenbank",
    location: "EU",
  },
];

export default function PrivacyPage() {
  return (
    <main className={styles.page}>
      <article className={styles.document}>
        <header className={styles.header}>
          <Link className={styles.brand} href="/login">
            {appName}
          </Link>
          <h1 className={styles.title}>Datenschutzerklärung</h1>
          <p className={styles.meta}>Stand: {lastUpdated}</p>
        </header>

        <nav aria-label="Inhalt" className={styles.toc}>
          <ol>
            <li><a href="#verantwortlicher">Verantwortlicher</a></li>
            <li><a href="#rollen">Unsere Rollen</a></li>
            <li><a href="#aufruf">Aufruf der Website und der App</a></li>
            <li><a href="#konto">Nutzerkonto und Anmeldung</a></li>
            <li><a href="#nachrichten">Nachrichten, Kommentare und Kontakte</a></li>
            <li><a href="#ki">KI-Antwortentwürfe und Übersetzungen</a></li>
            <li><a href="#chatgpt">Optionale ChatGPT-Verbindung</a></li>
            <li><a href="#push">Push-Benachrichtigungen</a></li>
            <li><a href="#cookies">Cookies und lokale Speicherung</a></li>
            <li><a href="#empfaenger">Empfänger und Auftragsverarbeiter</a></li>
            <li><a href="#drittland">Übermittlung in Drittländer</a></li>
            <li><a href="#speicherdauer">Speicherdauer</a></li>
            <li><a href="#sicherheit">Datensicherheit</a></li>
            <li><a href="#rechte">Ihre Rechte</a></li>
            <li><a href="#aenderungen">Änderungen</a></li>
          </ol>
        </nav>

        <section className={styles.section} id="verantwortlicher">
          <h2>1. Verantwortlicher</h2>
          <p>
            Verantwortlich für die Verarbeitung personenbezogener Daten auf dieser
            Website und in der Anwendung {appName} im Sinne der
            Datenschutz-Grundverordnung (DSGVO) ist:
          </p>
          <address className={styles.address}>
            {controller.name}
            {controller.address.map((line) => (
              <span key={line}>{line}</span>
            ))}
            <span>E-Mail: {controller.email}</span>
          </address>
          <p>
            Anfragen zum Datenschutz richten Sie bitte an die oben genannte
            E-Mail-Adresse.
          </p>
        </section>

        <section className={styles.section} id="rollen">
          <h2>2. Unsere Rollen</h2>
          <p>
            {appName} ist ein KI-gestützter Posteingang für kleine Unternehmen:
            Nachrichten und Kommentare aus Messengern und sozialen Netzwerken werden
            an einem Ort gebündelt, und {appName} schlägt Antwortentwürfe vor.
            Dabei haben wir zwei unterschiedliche Rollen:
          </p>
          <ul>
            <li>
              <strong>Verantwortlicher</strong> sind wir für die Daten der
              Nutzerinnen und Nutzer von {appName} — also Konto, Anmeldung und
              Einstellungen.
            </li>
            <li>
              <strong>Auftragsverarbeiter</strong> (Art. 28 DSGVO) sind wir für
              Nachrichten, Kommentare und Kontaktdaten, die Kundinnen und Kunden
              unserer Nutzer über verbundene Kanäle senden. Verantwortlich dafür ist
              das Unternehmen, das den jeweiligen Workspace betreibt. Wir verarbeiten
              diese Daten ausschließlich nach dessen Weisung und auf Grundlage eines
              Auftragsverarbeitungsvertrags.
            </li>
          </ul>
          <p>
            Wenn Sie einem Unternehmen geschrieben haben, das {appName} nutzt, wenden
            Sie sich mit Fragen zu Ihren Daten bitte zunächst an dieses Unternehmen.
            Wir unterstützen es bei der Beantwortung.
          </p>
        </section>

        <section className={styles.section} id="aufruf">
          <h2>3. Aufruf der Website und der App</h2>
          <p>
            Beim Aufruf verarbeitet unser Hosting-Anbieter Vercel technisch
            notwendige Verbindungsdaten: IP-Adresse, Datum und Uhrzeit des Zugriffs,
            aufgerufene Adresse sowie Browser und Betriebssystem (User-Agent). Die
            Serverfunktionen laufen in Frankfurt am Main.
          </p>
          <p>
            Zweck ist die Auslieferung der Anwendung sowie die Gewährleistung von
            Stabilität und Sicherheit. Rechtsgrundlage ist unser berechtigtes
            Interesse nach Art. 6 Abs. 1 lit. f DSGVO. Wir achten darauf, dass keine
            Nachrichteninhalte in Server-Protokolle gelangen.
          </p>
        </section>

        <section className={styles.section} id="konto">
          <h2>4. Nutzerkonto und Anmeldung</h2>
          <p>Für die Nutzung von {appName} verarbeiten wir:</p>
          <ul>
            <li>E-Mail-Adresse und Passwort (gespeichert ausschließlich als Hash);</li>
            <li>Zeitpunkte von Registrierung und Anmeldung;</li>
            <li>Zugehörigkeit zu Workspaces und Rolle darin;</li>
            <li>Einstellungen, zum Beispiel die Sprache der Oberfläche.</li>
          </ul>
          <p>
            E-Mails zur Bestätigung der Adresse, zum Zurücksetzen des Passworts und
            für Einladungen versenden wir über Postmark. Rechtsgrundlage ist die
            Erfüllung des Nutzungsvertrags nach Art. 6 Abs. 1 lit. b DSGVO.
          </p>
        </section>

        <section className={styles.section} id="nachrichten">
          <h2>5. Nachrichten, Kommentare und Kontakte</h2>
          <p>
            Verbindet ein Unternehmen einen Kanal (etwa Instagram, Facebook, WhatsApp
            oder Telegram), verarbeiten wir als Auftragsverarbeiter:
          </p>
          <ul>
            <li>Inhalte von Direktnachrichten und Kommentaren;</li>
            <li>
              Name bzw. Profilname, Plattform-Kennung und Profilbild der Absender;
              bei WhatsApp zusätzlich die Telefonnummer;
            </li>
            <li>Notizen, die Nutzer zu Kontakten anlegen;</li>
            <li>
              Antworten, Entwürfe, Vorlagen und die Wissensdatenbank des
              Unternehmens.
            </li>
          </ul>
          <p>
            Die Anbindung der Kanäle erfolgt über Zernio. Profilbilder liefern wir
            über unseren eigenen Server aus, sodass der Browser der Nutzer keine
            Verbindung zu den Servern der Plattform aufbaut.
          </p>
          <p>
            Unternehmen können einzelne Absender ausschließen. Nachrichten
            ausgeschlossener Absender werden verworfen, bevor sie gespeichert werden.
            Das Trennen eines Kanals in {appName} löscht keine Inhalte auf der
            Plattform selbst — dort gelten die Datenschutzbestimmungen des
            jeweiligen Anbieters.
          </p>
        </section>

        <section className={styles.section} id="ki">
          <h2>6. KI-Antwortentwürfe und Übersetzungen</h2>
          <p>
            Für Antwortentwürfe, automatische Antworten und Übersetzungen übermitteln
            wir den relevanten Gesprächsverlauf, Inhalte der Wissensdatenbank und die
            Anweisungen des Unternehmens an Mistral AI (Verarbeitung in der EU).
          </p>
          <p>
            Vor der Übermittlung ersetzen wir Telefonnummern, E-Mail-Adressen,
            IBAN und Kartennummern durch Platzhalter; der Name des Kontakts wird nur
            übermittelt, wenn er für die Antwort erforderlich ist. Eingaben werden
            nicht zum Training von Modellen verwendet.
          </p>
          <p>
            Die maskierten Anfragen und Antworten protokollieren wir zur
            Fehleranalyse und Kostenkontrolle; das Protokoll wird nach 30 Tagen
            automatisch gelöscht.
          </p>
          <p>
            Entwürfe sind Vorschläge, die das Unternehmen prüft und versendet.
            Automatische Antworten richtet das Unternehmen selbst ein. Eine
            automatisierte Entscheidung mit rechtlicher Wirkung im Sinne von Art. 22
            DSGVO findet nicht statt.
          </p>
          <p>
            Als Reserve ist technisch der Anbieter OpenRouter vorgesehen. Er ist
            derzeit nicht aktiv; vor einer Aktivierung aktualisieren wir diese
            Erklärung.
          </p>
        </section>

        <section className={styles.section} id="chatgpt">
          <h2>7. Optionale ChatGPT-Verbindung</h2>
          <p>
            Nutzer können ihr eigenes ChatGPT-Konto verbinden, um Entwürfe für
            Beiträge in sozialen Netzwerken zu erstellen. Die Verbindung erfolgt nur
            auf ausdrücklichen Wunsch über ein Freigabeformular. Übermittelt werden
            nur die dort ausgewählten Kategorien der Wissensdatenbank, die im Entwurf
            ausgewählten Angaben zur Marke (etwa Zielgruppe, Tonalität, Farben, Logo)
            sowie Texte und Bilder der Beiträge.
          </p>
          <p>
            Die Verarbeitung durch OpenAI erfolgt im Rahmen des ChatGPT-Kontos des
            Nutzers und der Bedingungen von OpenAI; eine Verarbeitung außerhalb der
            EU ist möglich. Der Zugriff gilt höchstens 30 Tage und lässt sich in{" "}
            {appName} jederzeit widerrufen. Aus ChatGPT übernommene Bilder speichern
            wir in unserem Dateispeicher. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b
            DSGVO.
          </p>
        </section>

        <section className={styles.section} id="push">
          <h2>8. Push-Benachrichtigungen</h2>
          <p>
            Wenn Sie Benachrichtigungen auf einem Gerät aktivieren, speichern wir die
            vom Browser erzeugte Push-Adresse und die zugehörigen Schlüssel. Eine
            Benachrichtigung enthält den Namen des Kontakts und den Kanal, aber
            nicht den Text der Nachricht. Sie wird über den Push-Dienst des
            Browser- bzw. Geräteherstellers (z. B. Apple, Google, Mozilla)
            zugestellt.
          </p>
          <p>
            Rechtsgrundlage ist Ihre Einwilligung (Art. 6 Abs. 1 lit. a DSGVO,
            § 25 Abs. 1 TDDDG). Sie können Benachrichtigungen jederzeit in den
            Einstellungen unter „App“ oder im Browser deaktivieren.
          </p>
        </section>

        <section className={styles.section} id="cookies">
          <h2>9. Cookies und lokale Speicherung</h2>
          <p>
            Wir verwenden ausschließlich technisch notwendige Cookies, um Sie nach
            der Anmeldung angemeldet zu halten. Damit die App installiert und
            schneller geladen werden kann, speichert ein Service Worker Dateien der
            Anwendung im Browser.
          </p>
          <p>
            Wir setzen keine Analyse-, Tracking- oder Werbe-Cookies ein. Deshalb
            benötigen wir kein Cookie-Banner (§ 25 Abs. 2 Nr. 2 TDDDG).
          </p>
        </section>

        <section className={styles.section} id="empfaenger">
          <h2>10. Empfänger und Auftragsverarbeiter</h2>
          <p>
            Wir setzen folgende Dienstleister ein, mit denen Verträge zur
            Auftragsverarbeitung bestehen oder abgeschlossen werden:
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Anbieter</th>
                  <th scope="col">Zweck</th>
                  <th scope="col">Daten</th>
                  <th scope="col">Ort der Verarbeitung</th>
                </tr>
              </thead>
              <tbody>
                {processors.map((processor) => (
                  <tr key={processor.name}>
                    <th scope="row">{processor.name}</th>
                    <td>{processor.purpose}</td>
                    <td>{processor.data}</td>
                    <td>{processor.location}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Nachrichten stammen von Plattformen wie Meta (Instagram, Facebook,
            WhatsApp) und Telegram; für die Verarbeitung dort gelten deren eigene
            Datenschutzbestimmungen. OpenAI erhält Daten nur bei der optionalen
            ChatGPT-Verbindung (Abschnitt 7).
          </p>
        </section>

        <section className={styles.section} id="drittland">
          <h2>11. Übermittlung in Drittländer</h2>
          <p>
            Soweit Daten in die USA oder andere Drittländer übermittelt werden,
            erfolgt dies auf Grundlage eines Angemessenheitsbeschlusses der
            EU-Kommission (EU-U.S. Data Privacy Framework), sofern der Empfänger
            zertifiziert ist, oder auf Grundlage von Standardvertragsklauseln nach
            Art. 46 Abs. 2 lit. c DSGVO.
          </p>
        </section>

        <section className={styles.section} id="speicherdauer">
          <h2>12. Speicherdauer</h2>
          <ul>
            <li>
              Konto- und Workspace-Daten speichern wir, bis der Workspace bzw. das
              Konto gelöscht wird. Mit dem Workspace werden alle zugehörigen Daten
              gelöscht.
            </li>
            <li>Das Protokoll der KI-Anfragen wird nach 30 Tagen gelöscht.</li>
            <li>
              Rohdaten eingehender Ereignisse der Kanäle werden nach einer
              festgelegten Frist automatisch gelöscht.
            </li>
            <li>
              Nicht mehr verwendete Bilder von Beiträgen werden nach einem Tag
              gelöscht, Protokolle abgeschlossener Übernahmen aus ChatGPT nach 30
              Tagen.
            </li>
            <li>
              Gesetzliche Aufbewahrungspflichten bleiben unberührt.
            </li>
          </ul>
        </section>

        <section className={styles.section} id="sicherheit">
          <h2>13. Datensicherheit</h2>
          <p>
            Die Übertragung erfolgt ausschließlich verschlüsselt (HTTPS). Zugangsdaten
            verbundener Kanäle speichern wir verschlüsselt. Die Daten verschiedener
            Workspaces sind auf Datenbankebene voneinander getrennt, sodass
            Mitglieder nur auf ihren eigenen Workspace zugreifen können.
          </p>
        </section>

        <section className={styles.section} id="rechte">
          <h2>14. Ihre Rechte</h2>
          <p>Sie haben nach der DSGVO das Recht auf:</p>
          <ul>
            <li>Auskunft über Ihre gespeicherten Daten (Art. 15);</li>
            <li>Berichtigung unrichtiger Daten (Art. 16);</li>
            <li>Löschung (Art. 17);</li>
            <li>Einschränkung der Verarbeitung (Art. 18);</li>
            <li>Datenübertragbarkeit (Art. 20);</li>
            <li>
              Widerspruch gegen Verarbeitungen auf Grundlage berechtigter
              Interessen (Art. 21);
            </li>
            <li>
              Widerruf einer erteilten Einwilligung mit Wirkung für die Zukunft
              (Art. 7 Abs. 3).
            </li>
          </ul>
          <p>
            Wenden Sie sich dazu an {controller.email}. Außerdem können Sie sich bei
            einer Datenschutz-Aufsichtsbehörde beschweren (Art. 77 DSGVO).
          </p>
        </section>

        <section className={styles.section} id="aenderungen">
          <h2>15. Änderungen</h2>
          <p>
            Wir passen diese Datenschutzerklärung an, wenn sich die Anwendung oder
            die eingesetzten Dienstleister ändern. Es gilt die jeweils auf dieser
            Seite veröffentlichte Fassung.
          </p>
        </section>
      </article>
    </main>
  );
}
