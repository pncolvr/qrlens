const emailAddress = /^[^\s@<>?&#:/]+@[^\s@<>?&#:/]+\.[^\s@<>?&#:/]+$/;
const unescapeField = value => value.replace(/\\(.)/g, "$1");
const unescapeText = value => value.replace(/\\([\\,;:nN])/g, (_, character) => /[nN]/.test(character) ? "\n" : character);
const escapeText = value => value.replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/[,;]/g, "\\$&");
const fileAction = (label, name, mime, content) => ({ label, file: { name, mime, content: content.replace(/\r\n|\r|\n/g, "\r\n") + "\r\n" } });

function readFields(source){
  return (source.match(/(?:\\.|[^;])+/g) || []).flatMap(field => {
    const separator = field.indexOf(":");
    return separator > 0 ? [[field.slice(0, separator).toUpperCase(), field.slice(separator + 1)]] : [];
  });
}

function property(source, name){
  const unfolded = source.replace(/\r?\n[ \t]/g, "");
  const match = unfolded.match(new RegExp(`^(?:[\\w-]+\\.)?${name}(?:;[^:\\r\\n]*)?:([^\\r\\n]*)`, "im"));
  return match ? unescapeText(match[1]) : "";
}

function contact(card){
  const name = property(card, "FN") || property(card, "N").split(";").filter(Boolean).join(" ");
  if (!name) return { type: "text", actions: [] };
  const details = [["contact.name", name], ["contact.phone", property(card, "TEL")], ["contact.email", property(card, "EMAIL")]];
  return { type: "contact", details: details.filter(([, value]) => value).map(([label, value]) => ({ label, value })), actions: [fileAction("actions.saveContact", "contact.vcf", "text/vcard;charset=utf-8", card)] };
}

// Only recognized, usable payloads become actions. Everything else stays plain text.
export function parseQR(text){
  let value = text.trim();
  if (/^BEGIN:VCARD\r?\n[\s\S]*\r?\nEND:VCARD$/i.test(value) && /^VERSION:(?:2\.1|3\.0|4\.0)\r?$/im.test(value)) return contact(value);
  if (/^MECARD:/i.test(value)){
    const fields = readFields(value.slice(7));
    const encodedName = fields.find(([key]) => key === "N")?.[1];
    if (!encodedName) return { type: "text", actions: [] };
    const parts = (encodedName.match(/(?:\\.|[^,])+/g) || []).map(unescapeField);
    const name = parts.length === 2 ? `${parts[1]} ${parts[0]}` : parts.join(" ");
    const mappings = { TEL: "TEL", EMAIL: "EMAIL", URL: "URL", ORG: "ORG", NOTE: "NOTE", BDAY: "BDAY", ADR: "ADR" };
    const lines = fields.filter(([key]) => mappings[key]).map(([key, data]) => `${mappings[key]}:${key === "ADR" ? ";;" : ""}${escapeText(unescapeField(data))}`);
    return contact(["BEGIN:VCARD", "VERSION:3.0", `FN:${escapeText(name)}`, `N:${[parts[0] || "", parts[1] || "", "", "", ""].map(escapeText).join(";")}`, ...lines, "END:VCARD"].join("\r\n"));
  }

  if (/^BEGIN:(VEVENT|VCALENDAR)\r?\n[\s\S]*\r?\nEND:\1$/i.test(value) && /^DTSTART(?:;[^:\r\n]*)?:\d{8}(?:T\d{6}Z?)?\r?$/im.test(value)){
    let calendar = value;
    if (/^BEGIN:VEVENT/i.test(value)){
      const extra = [!property(value, "UID") && `UID:${crypto.randomUUID()}@qr-lens`, !property(value, "DTSTAMP") && `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`].filter(Boolean);
      const event = value.replace(/^BEGIN:VEVENT\r?\n/i, `BEGIN:VEVENT\r\n${extra.length ? extra.join("\r\n") + "\r\n" : ""}`);
      calendar = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//QR Lens//EN\r\n${event}\r\nEND:VCALENDAR`;
    }
    return { type: "calendar", details: [{ label: "calendar.title", value: property(value, "SUMMARY") || property(value, "DTSTART") }], actions: [fileAction("actions.saveEvent", "event.ics", "text/calendar;charset=utf-8", calendar)] };
  }

  if (/^WIFI:/i.test(value)){
    const fields = Object.fromEntries(readFields(value.slice(5)).map(([key, data]) => [key, unescapeField(data)]));
    if (fields.S) return {
      type: "wifi",
      details: [{ label: "wifi.network", value: fields.S }, ...(fields.P ? [{ label: "wifi.password", value: fields.P }] : [])],
      actions: [{ label: "actions.copyNetwork", text: fields.S }, ...(fields.P ? [{ label: "actions.copyPassword", text: fields.P }] : [])]
    };
    return { type: "text", actions: [] };
  }

  if (/^MATMSG:/i.test(value)){
    const fields = Object.fromEntries(readFields(value.slice(7)).map(([key, data]) => [key, unescapeField(data)]));
    if (!emailAddress.test(fields.TO || "")) return { type: "text", actions: [] };
    return { type: "email", actions: [{ label: "actions.email", href: `mailto:${fields.TO}?subject=${encodeURIComponent(fields.SUB || "")}&body=${encodeURIComponent(fields.BODY || "")}` }] };
  }
  if (emailAddress.test(value)) value = `mailto:${value}`;

  if (/^(?:SMSTO|MMSTO):/i.test(value)){
    const [number, ...message] = value.slice(6).split(":");
    if (/^\+?[\d(). -]+$/.test(number) && /\d/.test(number)) return {
      type: "sms", actions: [{ label: "actions.message", href: `${/^MMSTO:/i.test(value) ? "mms" : "sms"}:${number}${message.length ? `?body=${encodeURIComponent(message.join(":"))}` : ""}` }]
    };
  }

  if (/^URLTO:/i.test(value)){
    value = value.slice(6);
    if (!/^https?:\/\//i.test(value)){
      const separator = value.indexOf(":");
      if (separator >= 0) value = value.slice(separator + 1);
    }
    if (/^URLTO:/i.test(value)) return { type: "text", actions: [] };
  }
  // A bare domain is a website too; leave sentences and unrelated text alone.
  if (/^(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z]{2,}(?::\d{1,5})?(?:[/?#]\S*)?$/i.test(value)) value = `https://${value}`;

  try {
    const url = new URL(value);
    const protocol = url.protocol;
    const web = ["http:", "https:"].includes(protocol) && url.hostname && !url.username && !url.password;
    if (web || ["itms-apps:", "itms-appss:", "market:"].includes(protocol)){
      if ((["apps.apple.com", "itunes.apple.com"].includes(url.hostname) && /\/(?:app|app-bundle)\//i.test(url.pathname)) || (web && ["appstore.com", "www.appstore.com"].includes(url.hostname)))
        return { type: "appStore", actions: [{ label: "actions.appStore", href: url.href }] };
      if ((web && url.hostname === "play.google.com" && /^\/store\/apps(?:\/|$)/.test(url.pathname)) || (protocol === "market:" && url.hostname === "details" && url.searchParams.get("id")))
        return { type: "playStore", actions: [{ label: "actions.playStore", href: url.href }] };
    }
    if (web){
      let path = url.pathname;
      try { path = decodeURIComponent(path); } catch { }
      if (/\.vcf$/i.test(path)) return { type: "contact", actions: [{ label: "actions.openContact", href: url.href }] };
      const pdf = /\.pdf$/i.test(path);
      return { type: pdf ? "pdf" : "url", actions: [{ label: pdf ? "actions.openPdf" : "actions.openLink", href: url.href }] };
    }
    if (protocol === "mailto:" && emailAddress.test(url.pathname))
      return { type: "email", actions: [{ label: "actions.email", href: url.href }] };
    if (["tel:", "sms:", "mms:"].includes(protocol) && /^\+?[\d(). -]+$/.test(url.pathname) && /\d/.test(url.pathname))
      return { type: protocol === "tel:" ? "phone" : "sms", actions: [{ label: protocol === "tel:" ? "actions.call" : "actions.message", href: url.href }] };
    if (protocol === "geo:"){
      const coordinates = url.pathname.split(";")[0].split(",");
      if (coordinates.length >= 2 && coordinates.every(part => part.trim() && Number.isFinite(Number(part))) && Math.abs(Number(coordinates[0])) <= 90 && Math.abs(Number(coordinates[1])) <= 180)
        return { type: "location", actions: [{ label: "actions.map", href: url.href }] };
    }
    // Custom URI schemes are handed to the OS only after the user taps Open app.
    const blocked = /^(?:https?|mailto|tel|sms|mms|smsto|mmsto|geo|wifi|matmsg|mecard|urlto|javascript|vbscript|data|file|blob|about|chrome(?:-extension)?|brave|edge|vivaldi|resource|view-source):$/;
    if (!blocked.test(protocol) && /^\w[\w+.-]*:\S+$/u.test(value) && (url.pathname || url.hostname))
      return { type: "app", actions: [{ label: "actions.openApp", href: url.href }] };
  } catch { }
  return { type: "text", actions: [] };
}
