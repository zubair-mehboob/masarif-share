// The shopkeeper's side of a shared Masarif grocery list. Everything is
// decrypted and encrypted here in the browser; the key comes from the part of
// the address after "#", which is never sent to the server.
(function () {
  "use strict";

  var FORMAT = "masarif-grocery-v1";
  var SAVE_DELAY_MS = 800;
  var RETRY_MS = 5000;
  var REFRESH_MS = 15000;
  var MAX_NAME = 80;
  var MAX_UNIT = 12;
  var MAX_EXTRAS = 50;
  var PLAY_STORE = "https://play.google.com/store/apps/details?id=com.masarif.app";

  var TEXT = {
    en: {
      language: "اردو",
      loading: "Opening the list…",
      expiredTitle: "This link has ended",
      expiredBody: "The list has expired or the customer closed it. Ask them to send a new link.",
      brokenTitle: "This link is incomplete",
      brokenBody: "Part of the link is missing, so the list cannot be opened. Ask the customer to send it again and open the whole link.",
      oldBrowserTitle: "This browser cannot open the list",
      oldBrowserBody: "Open the link in Chrome or Safari.",
      offlineTitle: "Could not load the list",
      offlineBody: "Check your internet connection.",
      retry: "Try again",
      intro: "Tick each item you have taken out, then enter its quantity and price.",
      until: "This link works until {time}.",
      wanted: "Wanted: {quantity}",
      quantity: "Quantity",
      unit: "Unit",
      price: "Price ({currency})",
      name: "Item",
      addExtra: "+ Add an item that is not on the list",
      remove: "Remove",
      extraLabel: "Added by you",
      total: "TOTAL",
      done: "Done",
      saving: "Saving…",
      saved: "Saved",
      notSaved: "Not saved. Trying again…",
      doneTitle: "Sent to the customer",
      doneBody: "They can now see the items, quantities and prices in their Masarif app.",
      edit: "Change something",
      saveMine: "Save to my Masarif",
      saveMineHint: "Keeps this sale in your own Masarif app. If nothing happens, open this page in Chrome, or install the app first.",
      getApp: "Get Masarif",
      itemsTaken: "{picked} of {total} items taken",
      nothingPriced: "Enter a price for at least one item you have ticked."
    },
    ur: {
      language: "English",
      loading: "فہرست کھل رہی ہے…",
      expiredTitle: "یہ لنک ختم ہو چکا ہے",
      expiredBody: "فہرست کی میعاد ختم ہو گئی ہے یا گاہک نے اسے بند کر دیا ہے۔ ان سے نیا لنک بھیجنے کو کہیں۔",
      brokenTitle: "یہ لنک نامکمل ہے",
      brokenBody: "لنک کا کچھ حصہ موجود نہیں، اس لیے فہرست نہیں کھل سکتی۔ گاہک سے دوبارہ بھیجنے کو کہیں اور پورا لنک کھولیں۔",
      oldBrowserTitle: "یہ براؤزر فہرست نہیں کھول سکتا",
      oldBrowserBody: "لنک کو کروم یا سفاری میں کھولیں۔",
      offlineTitle: "فہرست لوڈ نہیں ہو سکی",
      offlineBody: "اپنا انٹرنیٹ چیک کریں۔",
      retry: "دوبارہ کوشش کریں",
      intro: "جو چیز نکال لی ہے اس پر نشان لگائیں، پھر اس کی مقدار اور قیمت لکھیں۔",
      until: "یہ لنک {time} تک کام کرے گا۔",
      wanted: "مطلوب: {quantity}",
      quantity: "مقدار",
      unit: "اکائی",
      price: "قیمت ({currency})",
      name: "چیز",
      addExtra: "+ ایسی چیز شامل کریں جو فہرست میں نہیں",
      remove: "ہٹائیں",
      extraLabel: "آپ نے شامل کی",
      total: "کل رقم",
      done: "مکمل",
      saving: "محفوظ ہو رہا ہے…",
      saved: "محفوظ ہو گیا",
      notSaved: "محفوظ نہیں ہوا۔ دوبارہ کوشش جاری ہے…",
      doneTitle: "گاہک کو بھیج دیا گیا",
      doneBody: "اب وہ اپنی مصارف ایپ میں چیزیں، مقدار اور قیمتیں دیکھ سکتے ہیں۔",
      edit: "کچھ تبدیل کریں",
      saveMine: "میری مصارف میں محفوظ کریں",
      saveMineHint: "یہ فروخت آپ کی اپنی مصارف ایپ میں محفوظ ہو جائے گی۔ اگر کچھ نہ ہو تو یہ صفحہ کروم میں کھولیں، یا پہلے ایپ انسٹال کریں۔",
      getApp: "مصارف حاصل کریں",
      itemsTaken: "{total} میں سے {picked} چیزیں لی گئیں",
      nothingPriced: "جس چیز پر نشان لگایا ہے اس میں سے کم از کم ایک کی قیمت لکھیں۔"
    }
  };

  var app = document.getElementById("app");
  var bar = document.getElementById("bar");
  var totalLabel = document.getElementById("total-label");
  var totalValue = document.getElementById("total");
  var syncText = document.getElementById("sync");
  var doneButton = document.getElementById("done");
  var languageButton = document.getElementById("language");

  var shareId = (/^\/l\/([A-Za-z0-9_-]{22})$/.exec(location.pathname) || [])[1] || "";
  var keyText = (/[#&]k=([A-Za-z0-9_-]{43})(?:&|$)/.exec(location.hash) || [])[1] || "";
  var cryptoKey = null;
  var list = null;
  var listRev = 0;
  var expiresAt = 0;
  var fill = { v: 1, items: {}, extras: [], done: false };
  var view = "loading";
  var syncState = "";
  var saveTimer = null;
  var saving = false;
  var dirty = false;
  var language = "en";

  try {
    language = localStorage.getItem("masarif-language") || "";
  } catch (error) {
    language = "";
  }
  if (language !== "en" && language !== "ur") {
    language = /^ur/i.test(navigator.language || "") ? "ur" : "en";
  }

  function t(key, values) {
    var text = TEXT[language][key] || TEXT.en[key] || key;
    Object.keys(values || {}).forEach(function (name) {
      text = text.replace("{" + name + "}", values[name]);
    });
    return text;
  }

  function el(tag, attributes, children) {
    var node = document.createElement(tag);
    Object.keys(attributes || {}).forEach(function (name) {
      var value = attributes[name];
      if (name === "class") node.className = value;
      else if (name === "text") node.textContent = value;
      else if (name.slice(0, 2) === "on") node.addEventListener(name.slice(2), value);
      else if (value !== false && value !== null && value !== undefined) node.setAttribute(name, value === true ? "" : value);
    });
    (children || []).forEach(function (child) {
      if (child) node.appendChild(child);
    });
    return node;
  }

  function fromBase64Url(text) {
    var padded = text.replace(/-/g, "+").replace(/_/g, "/");
    while (padded.length % 4) padded += "=";
    var binary = atob(padded);
    var bytes = new Uint8Array(binary.length);
    for (var index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function toBase64Url(bytes) {
    var binary = "";
    for (var index = 0; index < bytes.length; index++) binary += String.fromCharCode(bytes[index]);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function associatedData(slot) {
    return new TextEncoder().encode(FORMAT + ":" + shareId + ":" + slot);
  }

  function open(slot, blob) {
    var bytes = fromBase64Url(blob);
    return crypto.subtle
      .decrypt({ name: "AES-GCM", iv: bytes.subarray(0, 12), additionalData: associatedData(slot) }, cryptoKey, bytes.subarray(12))
      .then(function (plain) {
        return JSON.parse(new TextDecoder().decode(plain));
      });
  }

  function seal(slot, value) {
    var nonce = crypto.getRandomValues(new Uint8Array(12));
    return crypto.subtle
      .encrypt({ name: "AES-GCM", iv: nonce, additionalData: associatedData(slot) }, cryptoKey, new TextEncoder().encode(JSON.stringify(value)))
      .then(function (cipher) {
        var sealed = new Uint8Array(12 + cipher.byteLength);
        sealed.set(nonce);
        sealed.set(new Uint8Array(cipher), 12);
        return toBase64Url(sealed);
      });
  }

  function cleanText(value, max) {
    return typeof value === "string" ? value.trim().slice(0, max) : "";
  }

  function cleanQuantity(value) {
    return typeof value === "number" && isFinite(value) && value > 0 && value <= 1000000 ? value : null;
  }

  function cleanAmount(value) {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 10000000000 ? value : null;
  }

  // The list comes from the customer and an earlier fill from anyone who had
  // the link, so both are checked field by field before they are shown.
  function readList(value) {
    if (!value || value.v !== 1 || !Array.isArray(value.items)) return null;
    var items = [];
    value.items.slice(0, 200).forEach(function (raw) {
      var id = cleanText(raw && raw.id, 64);
      var name = cleanText(raw && raw.name, MAX_NAME);
      if (id && name) items.push({ id: id, name: name, quantity: cleanQuantity(raw.quantity), unit: cleanText(raw.unit, MAX_UNIT) });
    });
    return { title: cleanText(value.title, MAX_NAME), currency: cleanText(value.currency, 3), items: items };
  }

  function readLine(raw) {
    return {
      picked: !!raw && raw.picked === true,
      quantity: cleanQuantity(raw && raw.quantity),
      unit: cleanText(raw && raw.unit, MAX_UNIT),
      amount: cleanAmount(raw && raw.amount)
    };
  }

  function readFill(value) {
    var next = { v: 1, items: {}, extras: [], done: false };
    if (!value || value.v !== 1) return next;
    if (value.items && typeof value.items === "object") {
      Object.keys(value.items).slice(0, 200).forEach(function (id) {
        next.items[id] = readLine(value.items[id]);
      });
    }
    if (Array.isArray(value.extras)) {
      value.extras.slice(0, MAX_EXTRAS).forEach(function (raw) {
        var id = cleanText(raw && raw.id, 64);
        if (!id) return;
        var line = readLine(raw);
        line.id = id;
        line.name = cleanText(raw.name, MAX_NAME);
        line.picked = true;
        next.extras.push(line);
      });
    }
    next.done = value.done === true;
    return next;
  }

  function lineFor(item) {
    if (!fill.items[item.id]) {
      fill.items[item.id] = { picked: false, quantity: item.quantity, unit: item.unit, amount: null };
    }
    return fill.items[item.id];
  }

  // Unnamed extra rows are left out of what is sent.
  function outgoingFill() {
    var items = {};
    list.items.forEach(function (item) {
      var line = lineFor(item);
      items[item.id] = { picked: line.picked, quantity: line.quantity, unit: line.unit || null, amount: line.amount };
    });
    return {
      v: 1,
      items: items,
      extras: fill.extras
        .filter(function (extra) { return extra.name.trim(); })
        .map(function (extra) {
          return { id: extra.id, name: extra.name.trim(), picked: true, quantity: extra.quantity, unit: extra.unit || null, amount: extra.amount };
        }),
      done: fill.done
    };
  }

  function billTotal() {
    var total = 0;
    list.items.forEach(function (item) {
      var line = lineFor(item);
      if (line.picked && line.amount) total += line.amount;
    });
    fill.extras.forEach(function (extra) {
      if (extra.name.trim() && extra.amount) total += extra.amount;
    });
    return total;
  }

  function money(minor) {
    var text = (minor / 100).toLocaleString("en", { maximumFractionDigits: 2 });
    return list.currency ? list.currency + " " + text : text;
  }

  function quantityText(quantity, unit) {
    if (quantity === null) return "";
    var text = String(Math.round(quantity * 1000) / 1000);
    return unit ? text + " " + unit : text;
  }

  function setSync(state) {
    syncState = state;
    syncText.textContent = state ? t(state) : "";
    syncText.className = state === "notSaved" ? "sync problem" : "sync";
  }

  function updateBar() {
    var picked = list.items.filter(function (item) { return lineFor(item).picked; }).length +
      fill.extras.filter(function (extra) { return extra.name.trim(); }).length;
    totalLabel.textContent = t("total") + " · " + t("itemsTaken", { picked: picked, total: list.items.length + fill.extras.length });
    totalValue.textContent = money(billTotal());
  }

  function expire() {
    view = "expired";
    clearTimeout(saveTimer);
    render();
  }

  function save() {
    clearTimeout(saveTimer);
    if (view !== "list" && view !== "done") return;
    if (saving) {
      dirty = true;
      return;
    }
    saving = true;
    dirty = false;
    setSync("saving");
    seal("fill", outgoingFill())
      .then(function (blob) {
        return fetch("/api/lists/" + shareId + "/fill", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fill: blob })
        });
      })
      .then(function (response) {
        saving = false;
        if (response.status === 404) return expire();
        if (!response.ok) throw new Error("save failed");
        if (dirty) save();
        else setSync("saved");
      })
      .catch(function () {
        saving = false;
        setSync("notSaved");
        saveTimer = setTimeout(save, RETRY_MS);
      });
  }

  function changed() {
    updateBar();
    setSync("saving");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, SAVE_DELAY_MS);
  }

  function numberInput(label, value, onChange, step) {
    var input = el("input", { type: "number", inputmode: "decimal", min: "0", step: step, value: value === null ? "" : String(value) });
    input.addEventListener("input", function () {
      var parsed = input.value.trim() === "" ? null : Number(input.value);
      onChange(parsed !== null && isFinite(parsed) && parsed >= 0 ? parsed : null);
      changed();
    });
    return el("label", { class: "field" }, [el("span", { text: label }), input]);
  }

  function textInput(label, value, max, onChange, extraClass) {
    var input = el("input", { type: "text", maxlength: String(max), value: value || "", autocapitalize: "off" });
    input.addEventListener("input", function () {
      onChange(input.value);
      changed();
    });
    return el("label", { class: "field" + (extraClass ? " " + extraClass : "") }, [el("span", { text: label }), input]);
  }

  function fieldsFor(line, isExtra) {
    return el("div", { class: "fields" + (isExtra ? " extra" : "") }, [
      numberInput(t("quantity"), line.quantity, function (value) { line.quantity = value && value > 0 ? value : null; }, "any"),
      textInput(t("unit"), line.unit, MAX_UNIT, function (value) { line.unit = value.trim(); }),
      numberInput(t("price", { currency: list.currency }), line.amount === null ? null : line.amount / 100, function (value) {
        line.amount = value === null ? null : Math.round(value * 100);
      }, "0.01")
    ]);
  }

  function itemCard(item) {
    var line = lineFor(item);
    var card = el("div", { class: "item" + (line.picked ? " picked" : "") });
    var checkbox = el("input", { type: "checkbox", checked: line.picked });
    var fields = null;
    function showFields() {
      card.className = "item" + (line.picked ? " picked" : "");
      if (line.picked && !fields) {
        fields = fieldsFor(line, false);
        card.appendChild(fields);
      } else if (!line.picked && fields) {
        card.removeChild(fields);
        fields = null;
      }
    }
    checkbox.addEventListener("change", function () {
      line.picked = checkbox.checked;
      showFields();
      changed();
    });
    var name = el("span", { class: "item-name", text: item.name });
    if (item.quantity !== null) {
      name.appendChild(el("span", { class: "item-want muted", text: t("wanted", { quantity: quantityText(item.quantity, item.unit) }) }));
    }
    card.appendChild(el("label", { class: "item-top" }, [checkbox, name]));
    showFields();
    return card;
  }

  function extraCard(extra) {
    var card = el("div", { class: "item picked" });
    card.appendChild(el("div", { class: "fields" }, [
      textInput(t("name") + " · " + t("extraLabel"), extra.name, MAX_NAME, function (value) { extra.name = value; }, "wide")
    ]));
    card.appendChild(fieldsFor(extra, true));
    card.appendChild(el("button", {
      type: "button",
      class: "remove",
      text: t("remove"),
      onclick: function () {
        fill.extras = fill.extras.filter(function (other) { return other !== extra; });
        changed();
        render();
      }
    }));
    return card;
  }

  function notice(titleKey, bodyKey, action) {
    return el("div", { class: "notice" }, [
      el("h1", { text: t(titleKey) }),
      el("p", { class: "muted", text: t(bodyKey) }),
      action || null
    ]);
  }

  function timeText() {
    return new Date(expiresAt).toLocaleString(language === "ur" ? "ur" : "en", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  }

  function render() {
    document.documentElement.lang = language;
    document.documentElement.dir = language === "ur" ? "rtl" : "ltr";
    languageButton.textContent = t("language");
    app.textContent = "";
    bar.hidden = view !== "list";
    if (view === "loading") {
      app.appendChild(el("p", { class: "muted", text: t("loading") }));
    } else if (view === "expired") {
      app.appendChild(notice("expiredTitle", "expiredBody"));
    } else if (view === "broken") {
      app.appendChild(notice("brokenTitle", "brokenBody"));
    } else if (view === "oldBrowser") {
      app.appendChild(notice("oldBrowserTitle", "oldBrowserBody"));
    } else if (view === "offline") {
      app.appendChild(notice("offlineTitle", "offlineBody", el("button", { type: "button", class: "wide-button", text: t("retry"), onclick: load })));
    } else if (view === "done") {
      app.appendChild(el("h1", { text: list.title || "Masarif" }));
      app.appendChild(el("div", { class: "notice" }, [
        el("h1", { text: "✓ " + t("doneTitle") }),
        el("p", { text: t("total") + ": " + money(billTotal()) }),
        el("p", { class: "muted", text: t("doneBody") }),
        el("div", { class: "stack" }, [
          el("a", { class: "button primary", href: "mehrfinance://grocery-sale#id=" + shareId + "&k=" + keyText, text: t("saveMine") }),
          el("p", { class: "muted", text: t("saveMineHint") }),
          el("a", { class: "button", href: PLAY_STORE, rel: "noopener", text: t("getApp") }),
          el("button", {
            type: "button",
            text: t("edit"),
            onclick: function () {
              fill.done = false;
              view = "list";
              render();
              save();
            }
          })
        ])
      ]));
      if (syncState === "notSaved") app.appendChild(el("p", { class: "sync problem", text: t("notSaved") }));
    } else {
      app.appendChild(el("h1", { text: list.title || "Masarif" }));
      app.appendChild(el("p", { class: "muted", text: t("intro") }));
      app.appendChild(el("p", { class: "muted", text: t("until", { time: timeText() }) }));
      list.items.forEach(function (item) { app.appendChild(itemCard(item)); });
      fill.extras.forEach(function (extra) { app.appendChild(extraCard(extra)); });
      if (fill.extras.length < MAX_EXTRAS) {
        app.appendChild(el("button", {
          type: "button",
          class: "wide-button",
          text: t("addExtra"),
          onclick: function () {
            var id = toBase64Url(crypto.getRandomValues(new Uint8Array(12)));
            fill.extras.push({ id: "x-" + id, name: "", picked: true, quantity: null, unit: "", amount: null });
            render();
            var inputs = app.querySelectorAll(".item:last-of-type input[type=text]");
            if (inputs[0]) inputs[0].focus();
          }
        }));
      }
      doneButton.textContent = t("done");
      updateBar();
      setSync(syncState);
    }
  }

  function fetchShare() {
    return fetch("/api/lists/" + shareId, { cache: "no-store" });
  }

  function load() {
    view = "loading";
    render();
    if (!shareId || !keyText) {
      view = "broken";
      return render();
    }
    if (!window.crypto || !crypto.subtle || !window.TextEncoder) {
      view = "oldBrowser";
      return render();
    }
    crypto.subtle
      .importKey("raw", fromBase64Url(keyText), "AES-GCM", false, ["encrypt", "decrypt"])
      .then(function (key) {
        cryptoKey = key;
        return fetchShare();
      })
      .then(function (response) {
        if (response.status === 404) {
          view = "expired";
          return render();
        }
        if (!response.ok) throw new Error("load failed");
        return response.json().then(function (body) {
          listRev = body.listRev;
          expiresAt = body.expiresAt;
          return open("list", body.list).then(
            function (plain) {
              list = readList(plain);
              if (!list) throw new Error("unreadable");
              // A fill that cannot be read is ignored and started again.
              return (body.fill ? open("fill", body.fill) : Promise.resolve(null)).catch(function () { return null; });
            },
            function () {
              view = "broken";
              render();
              return undefined;
            }
          );
        }).then(function (plainFill) {
          if (view === "broken") return;
          fill = readFill(plainFill);
          view = fill.done ? "done" : "list";
          render();
        });
      })
      .catch(function () {
        view = "offline";
        render();
      });
  }

  // Picks up items the customer adds after sharing, without disturbing typing.
  function refreshList() {
    if (view !== "list" || document.hidden) return;
    var active = document.activeElement;
    if (active && active.tagName === "INPUT" && active.type !== "checkbox") return;
    fetchShare()
      .then(function (response) {
        if (response.status === 404) return expire();
        if (!response.ok) return undefined;
        return response.json().then(function (body) {
          expiresAt = body.expiresAt;
          if (body.listRev === listRev) return undefined;
          return open("list", body.list).then(function (plain) {
            var next = readList(plain);
            if (!next || view !== "list") return;
            list = next;
            listRev = body.listRev;
            render();
          });
        });
      })
      .catch(function () {});
  }

  doneButton.addEventListener("click", function () {
    if (billTotal() <= 0) {
      syncText.textContent = t("nothingPriced");
      syncText.className = "sync problem";
      return;
    }
    fill.done = true;
    view = "done";
    render();
    window.scrollTo(0, 0);
    save();
  });

  languageButton.addEventListener("click", function () {
    language = language === "ur" ? "en" : "ur";
    try {
      localStorage.setItem("masarif-language", language);
    } catch (error) {
      // The choice simply will not be remembered.
    }
    render();
  });

  // Leaving the page with unsent changes: send them now rather than lose them.
  document.addEventListener("visibilitychange", function () {
    if (document.hidden && saveTimer && (view === "list" || view === "done")) save();
  });

  setInterval(refreshList, REFRESH_MS);
  load();
})();
