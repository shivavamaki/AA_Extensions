// src/features/medrecon-comment/content-medrecon-comment.js
// Injected into: arcusair.bdms.co.th  (#!/emr/emrview/emr/medreconcile)
//
// Turns the Med Reconcile "Comments" field into an editable dropdown
// (combobox): a native <datalist> is attached to ArcusAir's own Angular input
// so the pharmacist gets three preset choices AND can still type free text.
//
// Why a datalist (not a <select> replacing the input): the field is bound to
// Angular (ng-model="vm.selectedmedreconcile.comments") and ArcusAir's save
// logic reads THAT input. Attaching list=... to the existing input keeps the
// ng-model + save wiring completely intact — no value mirroring, no risk.
"use strict";

(function () {
  /* GUARD — Symbol on document (Angular wipes window.* on scope destroy,
     but cannot enumerate/delete a Symbol-keyed document property). */
  const _GUARD = Symbol.for("__BKN_MEDRECON_COMMENT__");
  if (document[_GUARD]) return;
  document[_GUARD] = true;

  const DATALIST_ID = "bkn-medrecon-comment-options";
  const WIRED_ATTR = "data-bkn-medrecon-list";

  // The preset comment values (blank state is the empty input itself).
  const OPTIONS = [
    "BKN's Medicines",
    "Non BKN's Medicines",
    "ไม่ได้ส่งยามาห้องยา",
  ];

  function onMedReconcilePage() {
    return location.href.includes("/emr/emrview/emr/medreconcile");
  }

  /** One shared <datalist> for all comment inputs on the page. */
  function ensureDatalist() {
    let dl = document.getElementById(DATALIST_ID);
    if (dl) return dl;
    dl = document.createElement("datalist");
    dl.id = DATALIST_ID;
    OPTIONS.forEach((val) => {
      const opt = document.createElement("option");
      opt.value = val;
      dl.appendChild(opt);
    });
    // Body is a stable host that survives Angular re-renders of the form.
    document.body.appendChild(dl);
    return dl;
  }

  /** Attach the datalist to every Med Reconcile "Comments" input.
   *  Targets by stable Angular attributes (not the numeric id commentstxt1),
   *  so multiple reconciliation rows (commentstxt1, commentstxt2, …) all get it. */
  function wireInputs() {
    if (!onMedReconcilePage()) return;
    const inputs = document.querySelectorAll(
      'input[ng-model="vm.selectedmedreconcile.comments"], input[name="comments"]'
    );
    if (!inputs.length) return;
    ensureDatalist();
    inputs.forEach((input) => {
      if (input.getAttribute(WIRED_ATTR)) return;   // already wired
      input.setAttribute("list", DATALIST_ID);
      input.setAttribute("autocomplete", "off");    // let the datalist show, not history
      input.setAttribute(WIRED_ATTR, "1");
    });
  }

  /* OBSERVER — debounced (rAF-gated) so an Angular mutation burst triggers a
     single re-wire pass. Re-attaches the list whenever Angular recreates the
     form/input on navigation or record selection. */
  let _scheduled = false;
  new MutationObserver(() => {
    if (_scheduled) return;
    _scheduled = true;
    requestAnimationFrame(() => {
      _scheduled = false;
      wireInputs();
    });
  }).observe(document.body, { childList: true, subtree: true });

  wireInputs();
})();
