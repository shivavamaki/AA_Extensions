/* ── medication-journey-core.js ────────────────────────────────────────────
   Defines window.MedicationJourney namespace with core functions.
   Loaded as a content script on arcusair.bdms.co.th
──────────────────────────────────────────────────────────────────────────── */
"use strict";
(function () {
  const NS = (window.MedicationJourney = window.MedicationJourney || {});

  /* ── Helpers ─────────────────────────────────────────────────────────── */
  function _safeText(el) {
    return el ? (el.textContent || el.innerText || "").trim() : "";
  }

  function _parseHashParams(hash) {
    const out = {};
    if (!hash) return out;
    const str = hash.startsWith("#") ? hash.slice(1) : hash;
    const parts = str.split(/[&;]/);
    for (const p of parts) {
      const eq = p.indexOf("=");
      if (eq < 0) continue;
      try {
        out[decodeURIComponent(p.slice(0, eq))] = decodeURIComponent(p.slice(eq + 1));
      } catch (_) { /* ignore bad encoding */ }
    }
    return out;
  }

  function _assignIfTruthy(target, key, value) {
    if (value && value !== "undefined" && value !== "null") target[key] = value;
  }

  /* ── extractArcusPatientContext ──────────────────────────────────────── */
  NS.extractArcusPatientContext = function extractArcusPatientContext() {
    const ctx = {
      patientuid: "", patientvisituid: "",
      patientId: "", hn: "", patientVisitId: "", an: "",
      patientName: "", loginuid: "", roleuid: "", organisationuid: "",
      parentorguid: "", logindepartmentuid: "",
      gender: "", age: "", dob: "", bed: "", dept: "", doctor: "",
      admitDate: "", _pp: "",
    };

    /* ── Level 1: URL hash params ───────────────────────────────────────── */
    try {
      const hashParams = _parseHashParams(window.location.hash);
      const qp = new URLSearchParams(window.location.search);
      const all = Object.assign({}, hashParams);
      for (const [k, v] of qp.entries()) all[k] = v;

      const MAP = {
        patientuid: ["patientuid", "patientUid", "patient_uid"],
        patientvisituid: ["patientvisituid", "patientVisitUid", "patientvisit_uid", "visituid"],
        patientId: ["patientId", "patientid", "patient_id", "hn"],
        patientVisitId: ["patientVisitId", "patientvisitid", "an"],
        loginuid: ["loginuid", "loginUid", "login_uid", "userid"],
        roleuid: ["roleuid", "roleUid", "role_uid"],
        organisationuid: ["organisationuid", "orguid", "org_uid", "organisationUid"],
        parentorguid: ["parentorguid", "parentOrguid", "parent_org_uid"],
        logindepartmentuid: ["logindepartmentuid", "deptuid", "dept_uid"],
        _pp: ["pp"],
      };
      for (const [field, candidates] of Object.entries(MAP)) {
        for (const c of candidates) {
          if (all[c]) { _assignIfTruthy(ctx, field, all[c]); break; }
        }
      }
    } catch (_) { /* ignore */ }

    /* ── Level 2: Angular scope ─────────────────────────────────────────── */
    try {
      if (window.angular) {
        const bannerSelectors = [
          "patient-emr-banner", ".main-banner", ".patient-banner",
          "[ng-controller*='banner']", "[ng-controller*='Banner']",
        ];
        for (const sel of bannerSelectors) {
          const el = document.querySelector(sel);
          if (!el) continue;
          const jqEl = window.angular.element(el);
          const scopes = [
            jqEl.scope(), jqEl.isolateScope(),
          ];
          try { scopes.push(jqEl.scope() && jqEl.scope().$parent); } catch (_) { /* */ }
          try { scopes.push(jqEl.scope() && jqEl.scope().$root); } catch (_) { /* */ }

          for (const sc of scopes) {
            if (!sc) continue;
            const candidates = [
              sc.patient, sc.patientData, sc.patientInfo,
              sc.vm && sc.vm.patient, sc.ctrl && sc.ctrl.patient,
              sc.user, sc.loginUser, sc.currentUser,
              sc.vm && sc.vm.user, sc.session,
            ];
            for (const obj of candidates) {
              if (!obj || typeof obj !== "object") continue;
              const o = obj;
              _assignIfTruthy(ctx, "patientuid",        o.patientuid || o.patientUid || o.uid);
              _assignIfTruthy(ctx, "patientvisituid",    o.patientvisituid || o.patientVisitUid || o.visitUid || o.visituid);
              _assignIfTruthy(ctx, "patientId",          o.patientId || o.hn || o.patientid);
              _assignIfTruthy(ctx, "patientVisitId",     o.patientVisitId || o.an || o.patientvisitid);
              _assignIfTruthy(ctx, "patientName",        o.patientName || o.name || o.fullName);
              _assignIfTruthy(ctx, "loginuid",           o.loginuid || o.loginUid || o.userId);
              _assignIfTruthy(ctx, "roleuid",            o.roleuid || o.roleUid);
              _assignIfTruthy(ctx, "organisationuid",    o.organisationuid || o.orgUid || o.organisationUid);
              _assignIfTruthy(ctx, "parentorguid",       o.parentorguid || o.parentOrguid || o.parentOrgUid);
              _assignIfTruthy(ctx, "logindepartmentuid", o.logindepartmentuid || o.deptUid || o.departmentUid);
            }
          }
        }
      }
    } catch (_) { /* ignore Angular errors */ }

    /* ── Level 3: LocalStorage scan ─────────────────────────────────────── */
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !/user|login|auth|token|patient|session/i.test(k)) continue;
        try {
          const parsed = JSON.parse(localStorage.getItem(k));
          if (!parsed || typeof parsed !== "object") continue;
          const o = parsed;
          _assignIfTruthy(ctx, "loginuid",           o.loginuid || o.loginUid || o.userId || o.uid);
          _assignIfTruthy(ctx, "roleuid",            o.roleuid || o.roleUid || o.role);
          _assignIfTruthy(ctx, "organisationuid",    o.organisationuid || o.orgUid || o.org_uid);
          _assignIfTruthy(ctx, "parentorguid",       o.parentorguid || o.parentOrguid);
          _assignIfTruthy(ctx, "logindepartmentuid", o.logindepartmentuid || o.deptUid);
          _assignIfTruthy(ctx, "patientuid",         o.patientuid || o.patientUid);
          _assignIfTruthy(ctx, "patientvisituid",    o.patientvisituid || o.patientVisitUid);
        } catch (_) { /* bad JSON */ }
      }
    } catch (_) { /* localStorage inaccessible */ }

    /* ── Level 4: DOM text extraction ───────────────────────────────────── */
    try {
      /* Name */
      if (!ctx.patientName) {
        const nameEls = document.querySelectorAll(".overme.ng-binding[aria-hidden='false'], .overme.ng-binding");
        for (const el of nameEls) {
          const t = _safeText(el);
          if (/[ก-๙A-Za-z]/.test(t) && !t.includes("/") && t.length > 3 && !/^\d/.test(t)) {
            ctx.patientName = t; break;
          }
        }
      }
      /* HN */
      if (!ctx.patientId) {
        const spans = document.querySelectorAll("span.ng-binding");
        for (const sp of spans) {
          const t = _safeText(sp);
          if (/^\d{2}-\d{2}-\d+$/.test(t)) { ctx.patientId = t; ctx.hn = t; break; }
        }
      }
      /* AN */
      if (!ctx.patientVisitId) {
        const spans = document.querySelectorAll("span.ng-binding");
        for (const sp of spans) {
          const t = _safeText(sp);
          if (/^[A-Z]\d{2}-\d{2}-\d+/.test(t)) {
            ctx.patientVisitId = t.split("/")[0].trim();
            ctx.an = ctx.patientVisitId;
            break;
          }
        }
      }
      /* Gender / DOB / Age */
      const genderWords = ["Male", "Female", "ชาย", "หญิง"];
      const allSpans = document.querySelectorAll("span.ng-binding, span");
      for (const sp of allSpans) {
        const t = _safeText(sp);
        if (!ctx.gender && genderWords.includes(t)) ctx.gender = t;
        if (!ctx.dob && /\d{2}[\/\-]\d{2}[\/\-]\d{4}/.test(t) && !/^\d{4}/.test(t)) ctx.dob = t;
        if (!ctx.age && /^\d{1,3}\s*(ปี|yr|year|y\/o)/i.test(t)) ctx.age = t;
      }
      /* DOB/Age from specific span class */
      const dobAgeSpans = document.querySelectorAll("span.margin-left-5.white-space-nowrap.overme.ng-binding");
      for (const sp of dobAgeSpans) {
        const t = _safeText(sp);
        if (!ctx.dob && /\d{2}[\/\-]\d{2}[\/\-]\d{4}/.test(t)) ctx.dob = t;
        if (!ctx.age && /\d+\s*(ปี|yr|year)/i.test(t)) ctx.age = t;
        if (!ctx.dob && !ctx.age && t) { ctx.dob = t; }
      }
      /* Bed */
      if (!ctx.bed) {
        const bedEl = document.querySelector("[ng-repeat*='bedoccupancy']");
        if (bedEl) {
          const t = _safeText(bedEl);
          const parts = t.split("/");
          ctx.bed = (parts[parts.length - 1] || "").trim() || t.trim();
        }
      }
      /* Dept / Doctor from .main-banner-section spans */
      const bannerSections = document.querySelectorAll(".main-banner-section");
      for (const sec of bannerSections) {
        const spans2 = sec.querySelectorAll("span");
        for (const sp of spans2) {
          const t = _safeText(sp);
          if (!t) continue;
          if (!ctx.dept && /ward|ward|IPD|OPD|แผนก/i.test(t)) ctx.dept = t;
          if (!ctx.doctor && /^(นพ|พญ|Dr\.?|นาย|นาง|นางสาว)\s/i.test(t)) ctx.doctor = t;
        }
      }
      /* AdmitDate */
      if (!ctx.admitDate) {
        const dateSpans = document.querySelectorAll(".main-banner span.ng-binding, patient-emr-banner span.ng-binding");
        for (const sp of dateSpans) {
          const t = _safeText(sp);
          if (/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}/.test(t) && ctx.dob && t !== ctx.dob) {
            ctx.admitDate = t; break;
          }
        }
      }
    } catch (_) { /* ignore DOM errors */ }

    /* ── Level 5: Jasper links on page ──────────────────────────────────── */
    try {
      const links = document.querySelectorAll("a[href*='aa-report.bdms.co.th']");
      for (const a of links) {
        try {
          const u = new URL(a.href);
          const p = u.searchParams;
          _assignIfTruthy(ctx, "patientuid",        p.get("patientuid"));
          _assignIfTruthy(ctx, "patientvisituid",   p.get("patientvisituid"));
          _assignIfTruthy(ctx, "loginuid",          p.get("loginuid"));
          _assignIfTruthy(ctx, "logindepartmentuid",p.get("logindepartmentuid"));
          _assignIfTruthy(ctx, "organisationuid",   p.get("organisationuid"));
          _assignIfTruthy(ctx, "roleuid",           p.get("roleuid"));
          _assignIfTruthy(ctx, "parentorguid",      p.get("parentorguid"));
          _assignIfTruthy(ctx, "_pp",               p.get("pp"));
          break;
        } catch (_) { /* bad URL */ }
      }
    } catch (_) { /* ignore */ }

    /* Sync aliases */
    if (!ctx.hn && ctx.patientId)       ctx.hn = ctx.patientId;
    if (!ctx.patientId && ctx.hn)       ctx.patientId = ctx.hn;
    if (!ctx.an && ctx.patientVisitId)  ctx.an = ctx.patientVisitId;
    if (!ctx.patientVisitId && ctx.an)  ctx.patientVisitId = ctx.an;

    return ctx;
  };

  /* ── thaiDateRangeToUtcIso ───────────────────────────────────────────── */
  NS.thaiDateRangeToUtcIso = function thaiDateRangeToUtcIso(startDateThai, endDateThai) {
    /* Thailand = UTC+7, no DST.
       Bangkok midnight (00:00:00 +07:00) = UTC previous day 17:00:00.000Z
       Bangkok end-of-day (23:59:59.999 +07:00) = UTC same day 16:59:59.999Z */
    function bangkokMidnightToUtc(yyyymmdd) {
      const [y, m, d] = yyyymmdd.split("-").map(Number);
      /* Date at Bangkok midnight = UTC 17:00 the previous calendar day */
      const utc = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0) - 7 * 3600 * 1000);
      return utc.toISOString();
    }
    function bangkokEndOfDayToUtc(yyyymmdd) {
      const [y, m, d] = yyyymmdd.split("-").map(Number);
      /* End of Bangkok day 23:59:59.999 +07 = UTC same Bangkok day 16:59:59.999Z */
      const utc = new Date(Date.UTC(y, m - 1, d, 16, 59, 59, 999));
      return utc.toISOString();
    }
    return {
      fromdate: bangkokMidnightToUtc(startDateThai),
      todate:   bangkokEndOfDayToUtc(endDateThai),
    };
  };

  /* ── buildMedicationReviewUrl ────────────────────────────────────────── */
  NS.buildMedicationReviewUrl = function buildMedicationReviewUrl(context, options) {
    options = options || {};
    const output = options.output || "xls";

    /* Date range defaults to last 30 days (Bangkok time) */
    let startDateThai = options.startDateThai;
    let endDateThai   = options.endDateThai;
    if (!startDateThai || !endDateThai) {
      const now = new Date();
      /* Convert current UTC to Bangkok by adding 7 hours */
      const bkk = new Date(now.getTime() + 7 * 3600 * 1000);
      const pad2 = n => String(n).padStart(2, "0");
      endDateThai   = `${bkk.getUTCFullYear()}-${pad2(bkk.getUTCMonth() + 1)}-${pad2(bkk.getUTCDate())}`;
      const start = new Date(bkk.getTime() - 30 * 24 * 3600 * 1000);
      startDateThai = `${start.getUTCFullYear()}-${pad2(start.getUTCMonth() + 1)}-${pad2(start.getUTCDate())}`;
    }

    const { fromdate, todate } = NS.thaiDateRangeToUtcIso(startDateThai, endDateThai);

    /* Build pp token */
    let pp = context._pp || "";
    if (!pp && context.loginuid) {
      const u = context.loginuid;
      const r = context.roleuid || "";
      const o = context.parentorguid || context.organisationuid || "";
      pp = `u=${u}&r=${r}&o=${o}`;
    }

    const base = "https://aa-report.bdms.co.th/jasperserver/flow.html";
    const params = new URLSearchParams();
    params.set("_flowId",             "viewReportFlow");
    params.set("output",              output);
    params.set("reportUnit",          "/BDMS/Pharmacy/medicationreview");
    params.set("userTimezone",        "Asia/bangkok");
    params.set("decorate",            "no");
    params.set("patientuid",          context.patientuid || "");
    params.set("patientvisituid",     context.patientvisituid || "");
    params.set("fromdate",            fromdate);
    params.set("todate",              todate);
    params.set("loginuid",            context.loginuid || "");
    params.set("logindepartmentuid",  context.logindepartmentuid || "");
    params.set("organisationuid",     context.organisationuid || "");
    params.set("userLocale",          "en");
    params.set("reporttemplateuid",   "5bd15f61f91f54068543a75f");
    params.set("preflangcode",        "th");
    params.set("isduplicate",         "false");
    params.set("pp",                  pp);

    return `${base}?${params.toString()}`;
  };

  /* ── buildEmarCrosstabUrl ───────────────────────────────────────────── */
  NS.buildEmarCrosstabUrl = function buildEmarCrosstabUrl(context, options) {
    options = options || {};
    const output = options.output || "xls";

    const now = new Date();
    const bkk = new Date(now.getTime() + 7 * 3600 * 1000);
    const pad2 = n => String(n).padStart(2, "0");
    const endDateThai = options.endDateThai ||
      `${bkk.getUTCFullYear()}-${pad2(bkk.getUTCMonth() + 1)}-${pad2(bkk.getUTCDate())}`;

    let startDateThai = options.startDateThai;
    if (!startDateThai && context.admitDate) {
      const a = String(context.admitDate);
      let m = a.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) {
        startDateThai = `${m[1]}-${m[2]}-${m[3]}`;
      } else {
        m = a.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (m) startDateThai = `${m[3]}-${String(m[2]).padStart(2,"0")}-${String(m[1]).padStart(2,"0")}`;
      }
    }
    if (!startDateThai) {
      const s = new Date(bkk.getTime() - 30 * 24 * 3600 * 1000);
      startDateThai = `${s.getUTCFullYear()}-${pad2(s.getUTCMonth() + 1)}-${pad2(s.getUTCDate())}`;
    }

    const { fromdate, todate } = NS.thaiDateRangeToUtcIso(startDateThai, endDateThai);

    let pp = context._pp || "";
    if (!pp && context.loginuid) {
      pp = `u=${context.loginuid}&r=${context.roleuid || ""}&o=${context.parentorguid || context.organisationuid || ""}`;
    }

    const base = "https://aa-report.bdms.co.th/jasperserver/flow.html";
    const params = new URLSearchParams();
    params.set("_flowId",            "viewReportFlow");
    params.set("output",             output);
    params.set("reportUnit",         "/BDMS/Pharmacy/emarprint_crosstab");
    params.set("userTimezone",       "Asia/bangkok");
    params.set("decorate",           "no");
    params.set("patientuid",         context.patientuid         || "");
    params.set("patientvisituid",    context.patientvisituid    || "");
    params.set("searchcriteria",     "");
    params.set("searchstring",       "Active,");
    params.set("agreementuid",       "");
    params.set("isduplicate",        "false");
    params.set("fromdate",           fromdate);
    params.set("todate",             todate);
    params.set("loginuid",           context.loginuid           || "");
    params.set("organisationuid",    context.organisationuid    || "");
    params.set("parentorguid",       context.parentorguid       || "");
    params.set("userLocale",         "th");
    params.set("reporttemplateuid",  "5e13186f47364912677b34cf");
    params.set("logindepartmentuid", context.logindepartmentuid || "");
    params.set("pp",                 pp);

    return `${base}?${params.toString()}`;
  };

  /* ── normalizeMedicationOrders ───────────────────────────────────────── */
  NS.normalizeMedicationOrders = function normalizeMedicationOrders(rawOrders) {
    if (!Array.isArray(rawOrders)) return [];
    const out = [];

    for (const r of rawOrders) {
      /* Filter non-MEDICINE */
      if (r.categoryType && r.categoryType !== "MEDICINE" &&
          r.categoryType !== "Medicine" && r.categoryType !== "medicine") {
        continue;
      }

      const status       = (r.status || "").trim();
      const route        = (r.route || "").trim();
      const freq         = (r.frequency || "").trim();
      const instruction  = (r.instruction || r.instructions || "").trim();
      const priority     = (r.priority || "").trim();

      const isCancelled     = !!r.cancelled || !!r.isCancelled ||
                              /cancel/i.test(status);
      const isDiscontinued  = !isCancelled && /discontinu|stop/i.test(status);
      const isPrn           = !!r.isPrn || /\bprn\b/i.test(freq) || /\bprn\b/i.test(instruction);
      const isStatOrder     = /\bstat\b/i.test(priority);
      const _isIv           = /\b(IV|intravenous|IntraVenously|ivdrip|infus)\b/i.test(route);
      const _isOral         = /\b(oral|orally|per\s+oral|PO|รับประทาน|กิน)\b/i.test(route);

      /* Diluent: instruction says "Will not flow to eMAR" OR NSS/D5W/Saline
         keywords in drug name combined with IV route */
      const diluentByInstruction = /will not flow to emar/i.test(instruction);
      const diluentByName        = _isIv &&
        /\b(NSS|Normal\s+Saline|Saline|D5W|D10W|Dextrose|Glucose|Ringer|LRS|lactated\s+ringer|sterile\s+water|sw\s+for\s+inj)/i
          .test(r.drugName || "");
      const isDiluent = diluentByInstruction || diluentByName;

      const normalized = {
        code:              r.code || "",
        drugName:          (r.drugName || r.drug || "").trim(),
        orderDate:         r.orderDate || "",
        orderNumber:       r.orderNumber || r.orderNo || "",
        status:            status,
        dosage:            r.dosage || r.dose || "",
        route:             route,
        frequency:         freq,
        duration:          r.duration || "",
        quantity:          r.quantity || r.qty || "",
        comments:          r.comments || "",
        instruction:       instruction,
        infusionRate:      r.infusionRate || "",
        infusionDuration:  r.infusionDuration || "",
        careprovider:      r.careprovider || r.orderBy || "",
        medReview:         r.medReview || "",
        startDateTime:     r.startDateTime || r.orderDate || "",
        endDateTime:       r.endDateTime || "",
        orderBy:           r.orderBy || r.careprovider || "",
        orderType:         r.orderType || "",
        categoryType:      r.categoryType || "MEDICINE",
        type:              r.type || "",
        orderFrom:         r.orderFrom || "",
        orderToDepartment: r.orderToDepartment || "",
        priority:          priority,
        alerts:            Array.isArray(r.alerts) ? r.alerts : [],
        /* computed */
        isCancelled,
        isDiscontinued,
        isPrn,
        isDiluent,
        isStatOrder,
        _isIv,
        _isOral,
        /* display helper */
        displayDose: [r.dosage || r.dose || "", route, freq].filter(Boolean).join(" · "),
        pharmacistNote: "",
        _raw: r,
      };

      out.push(normalized);
    }

    return out;
  };

  /* ── _normalizeDrugName ─ strips dosage/form suffixes for grouping ─── */
  function _normalizeDrugName(name) {
    if (!name) return "";
    return name
      .replace(/\b\d+(\.\d+)?\s*(mg|mcg|g|ml|mL|mEq|mmol|iu|IU|unit|units)\b/gi, "")
      .replace(/\b(tablet|capsule|cap|tab|inj|injection|solution|sol|syrup|cream|oint|patch|drop|drops|susp|suspension|powder|infusion|concentrate|vial|ampoule|amp)\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim()
      .toLowerCase();
  }

  /* ── createMedicationJourney ─────────────────────────────────────────── */
  NS.createMedicationJourney = function createMedicationJourney(normalizedOrders, patientContext) {
    if (!Array.isArray(normalizedOrders)) normalizedOrders = [];
    patientContext = patientContext || {};

    /* Group by normalized drug name */
    const groups = new Map();
    for (const order of normalizedOrders) {
      const key = _normalizeDrugName(order.drugName);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(order);
    }

    /* Sort each group by startDateTime */
    for (const [, arr] of groups) {
      arr.sort((a, b) => {
        const da = a.startDateTime || a.orderDate || "";
        const db = b.startDateTime || b.orderDate || "";
        return da < db ? -1 : da > db ? 1 : 0;
      });
    }

    /* Build events */
    const allEvents = [];

    for (const [normKey, orders] of groups) {
      for (let i = 0; i < orders.length; i++) {
        const cur  = orders[i];
        const prev = i > 0 ? orders[i - 1] : null;

        let eventType;
        let friendlyText;

        if (cur.isDiluent) {
          eventType    = "diluent";
          friendlyText = "สารน้ำเจือจาง";
        } else if (cur.isPrn) {
          eventType    = "prn";
          friendlyText = "ยานี้ใช้เมื่อมีอาการ (PRN)";
        } else if (cur.alerts && cur.alerts.length > 0) {
          eventType    = "alert";
          friendlyText = "มีข้อมูลแจ้งเตือน ควรตรวจสอบโดยเภสัชกร";
        } else if (!prev) {
          eventType    = "start";
          friendlyText = "ยาเริ่มใช้";
        } else if (cur.isCancelled || cur.isDiscontinued) {
          eventType    = "stop";
          friendlyText = "ยาหยุดใช้แล้ว";
        } else if (prev._isIv && cur._isOral) {
          eventType    = "switch";
          friendlyText = "ยาฉีดเปลี่ยนเป็นยากิน";
        } else {
          /* Check if dose/route/frequency changed */
          const doseChanged  = prev.dosage    !== cur.dosage;
          const routeChanged = prev.route     !== cur.route;
          const freqChanged  = prev.frequency !== cur.frequency;
          if (doseChanged || routeChanged || freqChanged) {
            eventType    = "change";
            friendlyText = "ยาปรับขนาด/วิธีใช้";
          } else {
            eventType    = "continue";
            friendlyText = "ยาต่อเนื่อง";
          }
        }

        allEvents.push({
          type:              eventType,
          patientFriendlyText: friendlyText,
          drugName:          cur.drugName,
          displayDose:       cur.displayDose,
          dosage:            cur.dosage,
          route:             cur.route,
          frequency:         cur.frequency,
          startDateTime:     cur.startDateTime,
          endDateTime:       cur.endDateTime,
          orderNumber:       cur.orderNumber,
          careprovider:      cur.careprovider,
          orderBy:           cur.orderBy,
          isPrn:             cur.isPrn,
          isDiluent:         cur.isDiluent,
          isCancelled:       cur.isCancelled,
          isDiscontinued:    cur.isDiscontinued,
          _isIv:             cur._isIv,
          _isOral:           cur._isOral,
          alerts:            cur.alerts,
          pharmacistNote:    cur.pharmacistNote,
          _normKey:          normKey,
          _raw:              cur,
        });
      }
    }

    /* Build timeline: group events by date (YYYY-MM-DD from startDateTime) */
    const timelineMap = new Map();
    for (const ev of allEvents) {
      const dateKey = (ev.startDateTime || "").slice(0, 10) || "unknown";
      if (!timelineMap.has(dateKey)) timelineMap.set(dateKey, []);
      timelineMap.get(dateKey).push(ev);
    }
    /* Sort dates ascending */
    const sortedDates = Array.from(timelineMap.keys()).sort();
    const timeline = sortedDates.map(date => ({ date, events: timelineMap.get(date) }));

    /* Categorised lists */
    const activeMedications  = normalizedOrders.filter(o => !o.isCancelled && !o.isDiscontinued && !o.isDiluent && !o.isPrn);
    const stoppedMedications = normalizedOrders.filter(o => o.isCancelled || o.isDiscontinued);
    const prnMedications     = normalizedOrders.filter(o => o.isPrn && !o.isCancelled);
    const diluentMedications = normalizedOrders.filter(o => o.isDiluent);
    const ivToOralSwitches   = allEvents.filter(e => e.type === "switch");
    const alerts             = allEvents.filter(e => e.type === "alert");

    return {
      patientContext,
      timeline,
      activeMedications,
      stoppedMedications,
      prnMedications,
      diluentMedications,
      ivToOralSwitches,
      alerts,
      allEvents,
      generatedAt: new Date().toISOString(),
      source: {
        medicationReviewUrl: "",
        usedJasperXls:     false,
        usedHtmlFallback:  false,
        usedMock:          false,
        totalOrders:       normalizedOrders.length,
      },
    };
  };

  /* ── openMedicationJourneyPage ───────────────────────────────────────── */
  NS.openMedicationJourneyPage = function openMedicationJourneyPage(journeyData) {
    chrome.runtime.sendMessage({ type: "OPEN_MEDICATION_JOURNEY", journey: journeyData });
  };

  /* ── MOCK_ORDERS ─────────────────────────────────────────────────────── */
  NS.MOCK_ORDERS = [
    {
      code: "PCM500", drugName: "Paracetamol 500 mg TABLET",
      orderDate: "2026-05-20", orderNumber: "RX001", status: "Ordered",
      dosage: "1 Tablet", route: "Orally", frequency: "Every 6 Hours If Needed",
      duration: "5 Days", quantity: "20 Tabs",
      startDateTime: "2026-05-20", endDateTime: "2026-05-25",
      orderBy: "Dr. Smith", categoryType: "MEDICINE", isPrn: true,
    },
    {
      code: "ROC2G", drugName: "Rocephin INJ 2 g",
      orderDate: "2026-05-20", orderNumber: "RX002", status: "Ordered",
      dosage: "2000 Milligram", route: "IntraVenously", frequency: "Every 24 Hours",
      duration: "7 Days", quantity: "7 Vials",
      startDateTime: "2026-05-20", endDateTime: "2026-05-27",
      orderBy: "Dr. Smith", categoryType: "MEDICINE",
    },
    {
      code: "NSS100", drugName: "NSS 0.9% INJ 100 mL",
      orderDate: "2026-05-20", orderNumber: "RX003", status: "Ordered",
      dosage: "100 mL", route: "IntraVenously", frequency: "Every 24 Hours",
      instruction: "Will not flow to eMAR", categoryType: "MEDICINE",
    },
    {
      code: "FLV100", drugName: "Flavoxate 100 mg TABLET",
      orderDate: "2026-05-21", orderNumber: "RX004", status: "Ordered",
      dosage: "1 Tablet", route: "Orally", frequency: "3 Times Daily After Meals",
      duration: "5 Days", quantity: "15 Tabs",
      startDateTime: "2026-05-21", endDateTime: "2026-05-26",
      orderBy: "Dr. Smith", categoryType: "MEDICINE",
    },
  ];

})();
