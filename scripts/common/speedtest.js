/* iobroker-scripts-export
 * id:         script.js.common.speedtest
 * name:       speedtest
 * engineType: Javascript/js
 * enabled:    true
 * expert:     true
 */
/*
* @copyright 2020 Stephan Kreyenborg <stephan@kreyenborg.koeln>
*
* @author 2020 Stephan Kreyenborg <stephan@kreyenborg.koeln>
*
* Dieses Skript dient zur freien Verwendung in ioBroker zur Überprüfung Deiner Internetgeschwindkeit mit Hilfe von Speedtest.
* Jegliche Verantwortung liegt beim Benutzer. Das Skript wurde unter Berücksichtigung der bestmöglichen Nutzung
* und Performance entwickelt.
* Der Entwickler versichert, das keine böswilligen Systemeingriffe im originalen Skript vorhanden sind.
*
* Sollte das Skript wider Erwarten nicht korrekt funktionieren, so hast Du jederzeit die Möglichkeit, Dich auf
* https://www.kreyenborg.koeln
* für Unterstützung zu melden. Jedes Skript besitzt seine eigene Kommentarseite, auf der,
* nach zeitlicher Möglichkeit des Autors, Hilfe angeboten wird. Ein Anrecht hierauf besteht nicht!
*
* Ansprüche gegenüber Dritten bestehen nicht.
*
* Skript Name: Speedtest
* Skript Version: 1.3
* Erstell-Datum: 29. November 2021
*
*/

// Datenpunkte neu erstellen
var ueberschreiben = false;

// Hauptdatenpunkt unterhalb javascript
var datenpunkt = "Speedtest.";

// Favorisierter Server
// Liste: https://www.speedtest.net/speedtest-servers.php
var fav_server = 44081;

// Speedtest Objekte
var objekt = ["JSON_Output",
"Ergebnisse.Ping",
"Ergebnisse.Jitter",
"Ergebnisse.Download_MBit",
"Ergebnisse.Upload_MBit",
"Ergebnisse.Download_MB",
"Ergebnisse.Upload_MB",
"Ergebnisse.OriginalDownload",
"Ergebnisse.OriginalUpload",
"ISP",
"IP",
"Ergebnisse.URL",
"Ergebnisse.ID",
"Test.Server.ServerID",
"Test.Server.ServerIP",
"Test.Server.Name",
"Test.Server.Stadt",
"Test.Server.Land",
"Test.Server.Adresse",
"Test.Daten.Download",
"Test.Daten.Upload",
"Test.Daten.OriginalDownload",
"Test.Daten.OriginalUpload",
"Test.Daten.DauerDownload",
"Test.Daten.DauerUpload",
"Test.Daten.Letzter_Speedtest"
];

// Beschreibung der Objekte
var beschreibung = ["JSON Ausgabe der Konsole",
"Ping in ms",
"Jitter in ms",
"Download Geschwindigkeit in MBit/s",
"Upload Geschwindigkeit in MBit/s",
"Download Geschwindigkeit in MB/s",
"Upload Geschwindigkeit in MB/s",
"Download Geschwindigkeit in Byte/s",
"Upload Geschwindigkeit in Byte/s",
"Internet Service Provider",
"externe IP",
"Adresse der Ergebnisse",
"ID der Ergebnisse",
"ID des getesteten Servers",
"IP des getesteten Servers",
"Anbieter des getesteten Servers",
"Stadt des getesteten Servers",
"Land des getesteten Servers",
"URL des getesteten Servers",
"Download Daten in MB",
"Upload Daten in MB",
"Download Daten in Byte",
"Upload Daten in Byte",
"Dauer des Download Test",
"Dauer des Upload Test",
"Letzter Speedtest"
];

// Einheiten der Objekte
var einheiten = ["",
"ms",
"ms",
"MBit/s",
"MBit/s",
"MB/s",
"MB/s",
"Byte/s",
"Byte/s",
"",
"",
"",
"",
"",
"",
"",
"",
"",
"",
"MB",
"MB",
"Byte",
"Byte",
"s",
"s",
""
];

// Typen der Objekte
var typen = ["string",
"number",
"number",
"number",
"number",
"number",
"number",
"number",
"number",
"string",
"string",
"string",
"string",
"number",
"string",
"string",
"string",
"string",
"string",
"number",
"number",
"number",
"number",
"number",
"number",
"string"
];

// Rollen der Objekte
var rolle = ["json",
"value",
"value",
"value",
"value",
"value",
"value",
"value",
"value",
"text",
"text",
"text",
"text",
"value",
"text",
"text",
"text",
"text",
"text",
"value",
"value",
"value",
"value",
"value",
"value",
"text"
];

// Schreibe Werte des JSON String in ein Array
function generiere_array(json_array) {
var j = JSON.parse(json_array);
var array_werte = [json_array,
j.ping.latency,
j.ping.jitter,
parseFloat((j.download.bandwidth / 125000).toFixed(2)),
parseFloat((j.upload.bandwidth / 125000).toFixed(2)),
parseFloat((j.download.bandwidth / (1024 * 1024)).toFixed(2)),
parseFloat((j.upload.bandwidth / (1024 * 1024)).toFixed(2)),
j.download.bandwidth,
j.upload.bandwidth,
j.isp,
j.interface.externalIp,
j.result.url,
j.result.id,
j.server.id,
j.server.ip,
j.server.name,
j.server.location,
j.server.country,
j.server.host,
parseFloat((j.download.bytes / (1024 * 1024)).toFixed(2)),
parseFloat((j.upload.bytes / (1024 * 1024)).toFixed(2)),
j.download.bytes,
j.upload.bytes,
parseFloat((j.download.elapsed / 1000).toFixed(2)),
parseFloat((j.upload.elapsed / 1000).toFixed(2)),
hole_datum()
];
return array_werte;
}

function speedtest() {
// temporäre Variable für das Array
var tmp_json;
// Kommando für den Speedtest
var kommando = "/usr/bin/speedtest -f json --accept-license --accept-gdpr";
if (fav_server > 0) {
kommando = kommando + " -s " + fav_server;
log("Speedtest mit Server " + fav_server + " gestartet! Der Test dauert zwischen 10 - 20 Sekunden!");
} else {
log("Speedtest gestartet! Der Test dauert zwischen 10 - 20 Sekunden!");
}
exec(kommando,
function (error, stdout) {
if (error) {
log('Speedtest konnte nicht ausgeführt werden! ' + error, 'error');
return;
} else {
tmp_json = generiere_array(stdout);
aktualisiere_datenpunkt(tmp_json);
log('Speedtest durchgeführt. Ergebnisse: Download: ' + tmp_json[5] + ' MB/s | Upload: ' + tmp_json[6] + ' MB/s | Ping: ' + tmp_json[1] + 'ms');
}
});
}

function aktualisiere_datenpunkt(werte) {
for (let i = 0; i < objekt.length; i++) {
setState(datenpunkt + objekt[i], werte[i], true);
}
}

// Erstelle die benötigten Datenpunkte
function datenpunkte_erstellen() {
for (var i = 0; i < objekt.length; i++) {
createState(datenpunkt + objekt[i], "", ueberschreiben, {
name: beschreibung[i],
desc: beschreibung[i],
type: typen[i],
role: rolle[i],
unit: einheiten[i]
});
}

// Alle Datenpunkte erstellt. Führe ersten Speedtest aus!
log('Speedtest: Datenpunkte erstellt! Erster Speedtest wird in 30 Sekunden ausgeführt!');
setTimeout(speedtest, 30000);
}

// Datum
function hole_datum() {
let datum = new Date();
let tag = '0' + datum.getDate();
let monat = '0' + (datum.getMonth() + 1);
let jahr = datum.getFullYear();
let stunde = '0' + datum.getHours();
let minute = '0' + datum.getMinutes();
let sekunde = '0' + datum.getSeconds();
return tag.substr(-2) + '.' + monat.substr(-2) + '.' + jahr + ' ' + stunde.substr(-2) + ':' + minute.substr(-2) + ':' + sekunde.substr(-2);
}

function speedtest_erster_start() {
log("Speedtest (zeitgesteuert): Erster Start des Skriptes! Datenpunkte werden erstellt!");
// Datenpunkte werden erstellt
datenpunkte_erstellen();
}

// Erster Start und Initialisierung
speedtest_erster_start();

// Alle 60 Minuten einen Speedtest ausführen
schedule('59 * * * *', speedtest);
