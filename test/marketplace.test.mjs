import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";
import { matches, videoLink } from "../src/lib/catalog.mjs";
import * as storage from "../src/lib/db.mjs";
import * as submissions from "../src/lib/submissions.mjs";
import { GET as getPhoto } from "../src/pages/media/[file].js";
import { GET as getCsv } from "../src/pages/panel/avisos.csv.js";
import {
	issueListingCode,
	listingVerification,
	verifyListingCode,
} from "../src/lib/listing-verification.mjs";
import {
	applyPanelChange,
	listingCsv,
	managedInquiries,
	managedListings,
	managedRecord,
	recordRevision,
	setListingStatus,
} from "../src/lib/listing-management.mjs";
import {
	featuredListings,
	homeCampaigns,
	saveCampaign,
	saveFeatured,
} from "../src/lib/home.mjs";
import { GET as getCampaignImage } from "../src/pages/campanas/[id].webp.js";
import { seed } from "../src/lib/seed.mjs";

const { db } = storage;
const { submitMachine } = submissions;

const sandbox = await mkdtemp(join(tmpdir(), "agua-test-"));
process.env.AGUA_DATA_DIR = sandbox;
const legacy = new DatabaseSync(join(sandbox, "aguamaquinas.sqlite"));
legacy.exec(`
  CREATE TABLE inquiries (
    id INTEGER PRIMARY KEY, machine_ref TEXT NOT NULL, name TEXT NOT NULL, contact TEXT NOT NULL,
    message TEXT NOT NULL, origin TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE inquiry_followups (
    inquiry_id INTEGER PRIMARY KEY REFERENCES inquiries(id), location TEXT NOT NULL DEFAULT '',
    budget TEXT NOT NULL DEFAULT '', timeframe TEXT NOT NULL DEFAULT '', stage TEXT NOT NULL DEFAULT 'new',
    minutes INTEGER, notes TEXT NOT NULL DEFAULT '', commission_currency TEXT NOT NULL DEFAULT '',
    sale_amount INTEGER, commission_agreed INTEGER, commission_paid INTEGER, closed_on TEXT NOT NULL DEFAULT '',
    paid_on TEXT NOT NULL DEFAULT ''
  );
  INSERT INTO inquiries (id, machine_ref, name, contact, message, origin)
    VALUES (900, '', 'Contacto anterior', 'anterior@example.com', 'Consulta guardada', 'Agua Máquinas');
  INSERT INTO inquiry_followups (inquiry_id, stage) VALUES (900, 'qualified');
`);
legacy.close();
const connection = db();
assert.equal(
	connection.prepare("SELECT count(*) AS count FROM machines").get().count,
	0,
);
const insertFixture = connection.prepare(`INSERT INTO machines
  (ref, title, category, brand, model, province, format, format_detail, capacity, condition, price, currency, photos, description, status, sample)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', 1)`);
for (const [id, ...fields] of seed) {
	fields[11] = JSON.stringify([`/equipos/${fields[11]}.webp`]);
	insertFixture.run("AM-" + id, ...fields);
}
after(async () => {
	connection.close();
	await rm(sandbox, { recursive: true, force: true });
});

async function challenge(email) {
	let code;
	const token = await issueListingCode(email, undefined, async (mail) => {
		assert.equal(mail.to, email);
		code = mail.text.match(/\b\d{6}\b/)[0];
	});
	return { token, code };
}

async function verifiedSeller(email) {
	const { token, code } = await challenge(email);
	verifyListingCode(token, code);
	return token;
}

test("buscar por capacidad, referencia y provincia", () => {
	assert.equal(
		connection
			.prepare("SELECT count(*) AS count FROM machines WHERE sample = 1")
			.get().count,
		12,
	);
	const first = connection
		.prepare("SELECT * FROM machines WHERE ref = 'AM-1041'")
		.get();
	assert.equal(
		matches(
			first,
			new URLSearchParams({
				q: "llenadora 20 litros",
				provincia: "Córdoba",
			}),
		),
		true,
	);
	assert.equal(matches(first, new URLSearchParams({ q: "am1041" })), true);
	assert.equal(
		matches(
			first,
			new URLSearchParams({ q: "AM-1041", provincia: "Santa Fe" }),
		),
		false,
	);
	assert.equal(matches(first, new URLSearchParams({ q: "am-1041" })), true);
});

test("los videos son enlaces seguros y específicos", () => {
	assert.equal(
		videoLink("https://youtu.be/dQw4w9WgXcQ?t=30"),
		"https://www.youtube.com/watch?v=dQw4w9WgXcQ",
	);
	assert.equal(
		videoLink("https://www.youtube.com/redirect?q=https://example.com"),
		null,
	);
	assert.equal(
		videoLink("https://youtube.com.example.com/watch?v=dQw4w9WgXcQ"),
		null,
	);
	assert.equal(videoLink("javascript:alert(1)"), null);
});

test("las sesiones del panel son distintas, revocables y caducan en el servidor", () => {
	const legacy = createHmac("sha256", storage.adminKey())
		.update("aguamaquinas:panel:v1")
		.digest("hex");
	assert.equal(storage.hasAdminSession(legacy), false);
	const first = storage.createAdminSession();
	const second = storage.createAdminSession();
	assert.notEqual(first, second);
	assert.equal(storage.hasAdminSession(first), true);
	assert.equal(storage.hasAdminSession(second), true);
	storage.revokeAdminSession(first);
	assert.equal(storage.hasAdminSession(first), false);
	assert.equal(storage.hasAdminSession(second), true);
	connection.exec("UPDATE admin_sessions SET expires_at = unixepoch()");
	assert.equal(storage.hasAdminSession(second), false);
});

test("los intentos de carga tienen un límite global y de simultaneidad", () => {
	const releaseFirst = submissions.startListingUpload();
	const releaseSecond = submissions.startListingUpload();
	try {
		assert.throws(() => submissions.startListingUpload(), { status: 429 });
	} finally {
		releaseFirst();
		releaseSecond();
	}
	for (let attempt = 0; attempt < 10; attempt++) {
		const release = submissions.startListingUpload();
		release();
	}
	assert.throws(() => submissions.startListingUpload(), { status: 429 });

	connection.exec(
		"UPDATE listing_upload_attempts SET started_at = unixepoch() - 600",
	);
	const releaseNext = submissions.startListingUpload();
	releaseNext();
	assert.equal(
		connection
			.prepare("SELECT count(*) AS count FROM listing_upload_attempts")
			.get().count,
		1,
	);
});

test("los códigos vencen, limitan intentos y no se pueden repetir", async () => {
	const { token, code } = await challenge("otp@example.com");
	assert.equal(listingVerification(token).verified_at, null);
	const wrong = code === "000000" ? "000001" : "000000";
	for (let attempt = 0; attempt < 5; attempt++)
		assert.throws(() => verifyListingCode(token, wrong));
	assert.throws(() => verifyListingCode(token, code));
	await assert.rejects(challenge("otp@example.com"), { status: 429 });

	const expired = await challenge("expired@example.com");
	connection.exec(
		"UPDATE listing_verifications SET expires_at = unixepoch() WHERE email = 'expired@example.com'",
	);
	assert.throws(() => verifyListingCode(expired.token, expired.code));

	const valid = await challenge("valid@example.com");
	verifyListingCode(valid.token, valid.code);
	assert.ok(listingVerification(valid.token).verified_at);
	assert.throws(() => verifyListingCode(valid.token, valid.code));
});

test("los avisos quedan pendientes y una imagen inválida limpia la carga parcial", async () => {
	const png = await sharp({
		create: { width: 16, height: 16, channels: 3, background: "blue" },
	})
		.png()
		.toBuffer();
	const form = new FormData();
	for (const [key, value] of Object.entries({
		title: "Lavadora de prueba",
		category: "lavadoras",
		province: "Córdoba",
		format: "bidones",
		condition: "usado",
		seller: "Persona de prueba",
		phone: "+54 9 351 123 4567",
		address: "Calle de prueba 123",
		locality: "Córdoba",
		email: "suplantado@example.com",
		description: "Equipo para probar el alta.",
		currency: "ARS",
		price: "1200",
	})) {
		form.set(key, value);
	}
	form.append("photos", new File([png], "valid.png", { type: "image/png" }));
	form.append(
		"photos",
		new File(["inválida"], "invalid.png", { type: "image/png" }),
	);
	await assert.rejects(submitMachine(form), /Verificá tu email/);
	const verification = await verifiedSeller("vendedor@example.com");
	await assert.rejects(submitMachine(form, verification), /No pudimos leer/);
	assert.deepEqual(await readdir(join(sandbox, "fotos")), []);
	form.set("photos", new File([png], "valid.png", { type: "image/png" }));
	const ref = await submitMachine(form, verification);
	const machine = connection
		.prepare("SELECT * FROM machines WHERE ref = ?")
		.get(ref);
	assert.equal(machine.status, "pending");
	assert.equal(machine.currency, "USD");
	assert.equal(machine.price, 1200);
	assert.equal(machine.contact, "");
	const contact = connection
		.prepare("SELECT * FROM listing_contacts WHERE machine_ref = ?")
		.get(ref);
	assert.equal(contact.email, "vendedor@example.com");
	assert.equal(contact.phone, "+5493511234567");
	assert.equal(contact.address, "Calle de prueba 123");
	assert.ok(contact.verified_at);
	assert.equal(listingVerification(verification), undefined);
	assert.ok(
		connection
			.prepare("SELECT 1 FROM notification_outbox WHERE event = ?")
			.get(`aviso/${ref}`),
	);
	assert.match(machine.photos, /\.webp/);
	assert.equal((await readdir(join(sandbox, "fotos"))).length, 1);

	const file = JSON.parse(machine.photos)[0].split("/").at(-1);
	const token = storage.createAdminSession();
	const request = {
		params: { file },
		cookies: { get: () => ({ value: token }) },
	};
	assert.equal((await getPhoto(request)).status, 200);
	assert.equal(getCsv({ cookies: { get: () => undefined } }).status, 403);
	const csv = getCsv(request);
	assert.equal(csv.headers.get("cache-control"), "private, no-store");
	assert.match(await csv.text(), /vendedor@example\.com/);
	assert.match(listingCsv([{ ...machine, title: "=1+1" }]), /"'=1\+1"/);
	storage.revokeAdminSession(token);
	assert.equal((await getPhoto(request)).status, 404);
	assert.equal(getCsv(request).status, 403);
	assert.equal(setListingStatus(ref, "published"), true);

	const orphan = "foto-sin-aviso.webp";
	await writeFile(join(sandbox, "fotos", orphan), Buffer.alloc(1024));
	const before = (await readdir(join(sandbox, "fotos"))).sort();
	process.env.AGUA_PHOTO_QUOTA_BYTES = "1024";
	try {
		const first = await verifiedSeller("cuota1@example.com");
		const second = await verifiedSeller("cuota2@example.com");
		await assert.rejects(submitMachine(form, first), { status: 503 });
		assert.deepEqual(
			(await readdir(join(sandbox, "fotos"))).sort(),
			before,
		);
		assert.equal(
			connection
				.prepare(
					"SELECT count(*) AS count FROM machines WHERE sample = 0",
				)
				.get().count,
			1,
		);

		const photoSize = (await stat(join(sandbox, "fotos", file))).size;
		process.env.AGUA_PHOTO_QUOTA_BYTES = String(1024 + 2 * photoSize);
		const results = await Promise.allSettled([
			submitMachine(form, first),
			submitMachine(form, second),
		]);
		assert.equal(
			results.filter((result) => result.status === "fulfilled").length,
			1,
		);
		assert.equal(
			results.find((result) => result.status === "rejected").reason
				.status,
			503,
		);
		assert.equal((await readdir(join(sandbox, "fotos"))).length, 3);
	} finally {
		delete process.env.AGUA_PHOTO_QUOTA_BYTES;
	}
});

test("una consulta vinculada guarda los dos contactos y admite un mensaje vacío sobre una base anterior", async () => {
	const { deliverNotification } = await import("../src/lib/mail.mjs");
	const form = new URLSearchParams({
		name: "Compradora",
		whatsapp: "0111568641122",
		email: "compradora@example.com",
	});
	const event = submissions.submitInquiry(form, "EJ-1046", "pedro");
	const record = managedRecord("consulta", event.split("/").at(-1));
	assert.equal(record.machine_ref, "EJ-1046");
	assert.equal(record.machine_title, "Ozonizador con torre de contacto");
	assert.equal(record.buyer_whatsapp, "0111568641122");
	assert.equal(record.buyer_email, "compradora@example.com");
	assert.equal(record.message, "");
	assert.equal(
		managedRecord("consulta", "900").contact,
		"anterior@example.com",
	);
	assert.equal(managedRecord("consulta", "900").stage, "qualified");
	assert.throws(
		() => submissions.submitInquiry(form, "AM-INEXISTENTE", "pedro"),
		{ status: 404 },
	);
	assert.throws(() => submissions.submitInquiry(form, "", "pedro"), {
		status: 400,
	});
	form.delete("email");
	assert.throws(() => submissions.submitInquiry(form, "EJ-1046", "pedro"), {
		status: 400,
	});
	const previous = process.env.AGUA_NOTIFICATION_EMAIL;
	process.env.AGUA_NOTIFICATION_EMAIL = "panel@example.com";
	try {
		await deliverNotification(event, async () => {
			throw new Error("Proveedor caído");
		});
		assert.equal(
			connection
				.prepare(
					"SELECT sent_at FROM notification_outbox WHERE event = ?",
				)
				.get(event).sent_at,
			null,
		);
		const sent = [];
		await deliverNotification(event, async (mail) => {
			sent.push(mail);
		});
		await deliverNotification(event, async (mail) => {
			sent.push(mail);
		});
		assert.equal(sent.length, 1);
		assert.equal(sent[0].to, "panel@example.com");
		assert.equal(sent[0].replyTo, "compradora@example.com");
		assert.match(sent[0].subject, /EJ-1046.*Ozonizador/);
		assert.match(sent[0].text, /WhatsApp: 0111568641122/);
	} finally {
		if (previous === undefined) delete process.env.AGUA_NOTIFICATION_EMAIL;
		else process.env.AGUA_NOTIFICATION_EMAIL = previous;
	}
});

test("una consulta guarda una alerta pendiente y los avisos anteriores requieren verificación para aprobarse", () => {
	const form = new FormData();
	form.set("name", "Comprador");
	form.set("email", "comprador@example.com");
	form.set("whatsapp", "+54 9 351 123 4567");
	form.set("message", "¿Está disponible?");
	const event = submissions.submitInquiry(form, "EJ-1041", "sitio-anterior");
	assert.match(event, /^consulta\/EJ-1041\/\d+$/);
	assert.equal(
		connection
			.prepare("SELECT sent_at FROM notification_outbox WHERE event = ?")
			.get(event).sent_at,
		null,
	);
	connection.exec(
		"UPDATE machines SET sample = 0, status = 'pending' WHERE ref = 'AM-1041'",
	);
	assert.equal(setListingStatus("AM-1041", "published"), false);
});

test("el piloto conserva origen, calificación, tiempos y comisión de una consulta", async () => {
	const { GET } = await import("../src/pages/panel/consultas.csv.js");
	const input = new URLSearchParams({
		name: "Comprador del piloto",
		email: "comprador@example.com",
		whatsapp: "+54 9 351 123 4567",
		message: "=1+1",
		location: "Rosario, Santa Fe",
		budget: "USD 8.000–10.000",
		timeframe: "month",
	});
	const event = submissions.submitInquiry(input, "", "sitio-anterior");
	const key = event.split("/").at(-1);
	connection
		.prepare(
			"UPDATE inquiries SET created_at = '2026-11-05 14:00:00' WHERE id = ?",
		)
		.run(key);
	const record = managedRecord("consulta", key);
	assert.equal(record.origin, "Sitio anterior");
	assert.equal(record.location, "Rosario, Santa Fe");
	assert.equal(record.budget, "USD 8.000–10.000");
	assert.equal(record.timeframe, "month");
	assert.equal(record.stage, "new");
	const change = new URLSearchParams({
		revision: recordRevision(record),
		origin: "Sitio anterior",
		stage: "closed",
		minutes: "90",
		commission_currency: "USD",
		sale_amount: "9000",
		commission_agreed: "450",
		commission_paid: "450.50",
		closed_on: "2026-11-10",
		paid_on: "2026-11-11",
		notes: "Visita realizada",
	});
	change.set("paid_on", "2026-02-30");
	assert.throws(() => applyPanelChange("consulta", key, "followup", change), {
		status: 400,
	});
	change.set("paid_on", "2026-11-11");
	applyPanelChange("consulta", key, "followup", change);
	assert.equal(managedRecord("consulta", key).commission_paid, 45050);
	assert.throws(() => applyPanelChange("consulta", key, "followup", change), {
		status: 409,
	});
	assert.equal(GET({ cookies: { get: () => undefined } }).status, 403);
	const csv = await GET({
		cookies: { get: () => ({ value: storage.createAdminSession() }) },
	}).text();
	assert.match(csv, /"Sitio anterior"/);
	assert.match(csv, /"'=1\+1"/);
	assert.match(csv, /"450,50"/);
	assert.match(csv, /"2026-11-10";"5";"90"/);
});

test("el rango es compatible con precios anteriores y el recordatorio solo vale para el ciclo vigente", async () => {
	const {
		runAvailabilityReminders,
		listingFromAvailabilityLink,
		respondToAvailability,
	} = await import("../src/lib/availability.mjs");
	const { priceLabel } = await import("../src/lib/catalog.mjs");
	const ref = "AM-1043";
	connection
		.prepare(
			"UPDATE machines SET sample = 0, status = 'pending' WHERE ref = ?",
		)
		.run(ref);
	connection
		.prepare(
			"INSERT INTO listing_contacts VALUES (?, ?, ?, ?, ?, unixepoch())",
		)
		.run(
			ref,
			"recordatorio@example.com",
			"+5493511234567",
			"Calle 123",
			"Córdoba",
		);
	assert.equal(setListingStatus(ref, "published"), true);
	assert.ok(managedRecord("aviso", ref).confirmed_at > 0);
	assert.equal(priceLabel({ price: 12000, currency: "USD" }), "US$ 12.000");
	assert.equal(
		priceLabel({ price: 12000, price_max: 14000, currency: "USD" }),
		"US$ 12.000 a 14.000",
	);
	assert.equal(
		priceLabel({ price: null, currency: "USD" }),
		"Consultar precio",
	);
	connection
		.prepare(
			"UPDATE listing_details SET confirmed_at = unixepoch() - 31 * 86400 WHERE machine_ref = ?",
		)
		.run(ref);
	const messages = [];
	const send = async (mail) => {
		messages.push(mail);
	};
	const summary = await runAvailabilityReminders(
		"https://aguamaquinas.example",
		send,
	);
	assert.equal(summary.sent, 1);
	assert.equal(
		(await runAvailabilityReminders("https://aguamaquinas.example", send))
			.sent,
		0,
	);
	const url = new URL(messages[0].text.match(/https:\/\/\S+/)[0]);
	const token = url.searchParams.get("aviso");
	assert.equal(listingFromAvailabilityLink(token).ref, ref);
	assert.equal(respondToAvailability(token + "x", "available"), false);
	assert.equal(respondToAvailability(token, "available"), true);
	assert.equal(respondToAvailability(token, "sold"), false);
	assert.equal(managedRecord("aviso", ref).status, "published");
	connection
		.prepare("DELETE FROM listing_details WHERE machine_ref = ?")
		.run(ref);
	connection
		.prepare("DELETE FROM listing_contacts WHERE machine_ref = ?")
		.run(ref);
	connection.prepare("UPDATE machines SET sample = 1 WHERE ref = ?").run(ref);
});

test("la planilla evita cambios obsoletos y permite recuperar avisos y consultas", () => {
	const ref = "AM-1042";
	connection.prepare("UPDATE machines SET sample = 0 WHERE ref = ?").run(ref);
	connection
		.prepare(
			"INSERT INTO listing_contacts VALUES (?, ?, ?, ?, ?, unixepoch())",
		)
		.run(
			ref,
			"verificado@example.com",
			"+5493511234567",
			"Calle 123",
			"Córdoba",
		);
	const form = (kind, key, values = {}) =>
		new URLSearchParams({
			revision: recordRevision(managedRecord(kind, key)),
			...values,
		});
	const seller = form("aviso", ref, {
		seller: "Vendedor nuevo",
		phone: "+54 9 351 234 5678",
		email: "otro@example.com",
	});
	applyPanelChange("aviso", ref, "seller", seller);
	const edited = managedRecord("aviso", ref);
	assert.equal(edited.seller, "Vendedor nuevo");
	assert.equal(edited.email, "verificado@example.com");
	assert.equal(edited.phone, "+5493512345678");
	assert.throws(() => applyPanelChange("aviso", ref, "delete", seller), {
		status: 409,
	});

	applyPanelChange("aviso", ref, "delete", form("aviso", ref));
	assert.equal(managedRecord("aviso", ref).status, "paused");
	assert.equal(
		managedListings().some((item) => item.ref === ref),
		false,
	);
	assert.equal(
		managedListings(true).some((item) => item.ref === ref),
		true,
	);
	assert.ok(!listingCsv().includes(ref));
	assert.equal(setListingStatus(ref, "published"), false);
	applyPanelChange("aviso", ref, "restore", form("aviso", ref));
	assert.equal(managedRecord("aviso", ref).status, "published");
	assert.equal(managedRecord("aviso", ref).photos, edited.photos);

	const inquiry = managedInquiries().find(
		(item) => item.machine_ref === "EJ-1041",
	);
	const key = String(inquiry.id);
	applyPanelChange("consulta", key, "delete", form("consulta", key));
	assert.equal(
		managedInquiries().some((item) => item.id === inquiry.id),
		false,
	);
	applyPanelChange("consulta", key, "restore", form("consulta", key));
	assert.equal(managedRecord("consulta", key).contact, inquiry.contact);
});

test("la portada ordena sus campañas y solo destaca avisos publicados", async () => {
	const form = new FormData();
	for (const [key, value] of Object.entries({
		title: "Campaña uno",
		description: "Equipos disponibles",
		label: "Consultar",
		href: "/consulta",
		position: "1",
		active: "1",
	}))
		form.set(key, value);
	const png = await sharp({
		create: { width: 4, height: 4, channels: 3, background: "blue" },
	})
		.png()
		.toBuffer();
	form.set("image", new File([png], "banner.png", { type: "image/png" }));
	await saveCampaign(form);
	const [campaign] = homeCampaigns(true);
	assert.equal(campaign.has_image, 1);
	assert.equal(campaign.sponsored, 0);
	const request = {
		params: { id: String(campaign.id) },
		cookies: { get: () => undefined },
	};
	assert.equal(
		getCampaignImage(request).headers.get("Content-Type"),
		"image/webp",
	);
	form.set("href", "/\\otro.example");
	await assert.rejects(saveCampaign(form), /enlace interno/);
	form.set("href", "/consulta");
	form.set("sponsored", "1");
	await saveCampaign(form, campaign.id);
	assert.equal(homeCampaigns(true)[0].sponsored, 1);
	form.delete("active");
	await saveCampaign(form, campaign.id);
	assert.equal(homeCampaigns(true).length, 0);
	assert.equal(getCampaignImage(request).status, 404);

	const ref = "AM-1043";
	assert.throws(
		() => saveFeatured(new URLSearchParams({ "ref-1": ref })),
		/avisos publicados/,
	);
	connection.prepare("UPDATE machines SET sample = 0 WHERE ref = ?").run(ref);
	saveFeatured(new URLSearchParams({ "ref-5": ref, "sponsor-5": "1" }));
	assert.equal(featuredListings()[0].featured_position, 5);
	assert.equal(featuredListings()[0].sponsored, 1);
	assert.throws(
		() => saveFeatured(new URLSearchParams({ "ref-1": ref, "ref-2": ref })),
		/aviso distinto/,
	);
	connection
		.prepare("UPDATE machines SET status = 'sold' WHERE ref = ?")
		.run(ref);
	assert.deepEqual(featuredListings(), []);
});
