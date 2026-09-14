"use strict";
// Transport-neutral HM request contract. Credentials stay in the legacy context;
// they are intentionally excluded from request metadata and diagnostics.
(() => {
  function fromLegacy(message) {
    const context = message?.context || {};
    const request = {
      schemaVersion: 1,
      reportType: message?.type === 'LOAD_MED_TABLE_OPD' ? 'home-med-opd' : 'home-med-ipd',
      identity: { patientUid: context.patientuid || '', visitUid: context.patientvisituid || '' },
      source: { system: 'arcusair', revision: null, fingerprint: null },
      presentation: { language: 'th', templateVersion: 'hm-a4-v1' },
    };
    return { request, context };
  }
  function validate(request) {
    const errors = [];
    if (request?.schemaVersion !== 1) errors.push('Unsupported schema version');
    if (!['home-med-ipd', 'home-med-opd'].includes(request?.reportType)) errors.push('Unsupported report type');
    for (const field of ['patientUid', 'visitUid']) {
      if (typeof request?.identity?.[field] !== 'string' || !request.identity[field].trim()) errors.push(`Missing ${field}`);
    }
    return errors;
  }
  function diagnose(request) {
    const errors = validate(request);
    return { valid: !errors.length, errors, schemaVersion: request?.schemaVersion,
      reportType: request?.reportType, language: request?.presentation?.language,
      templateVersion: request?.presentation?.templateVersion,
      hasRevision: !!request?.source?.revision, hasFingerprint: !!request?.source?.fingerprint };
  }
  // This is the only Chrome-specific transport. A future HTTP report-session
  // adapter can provide the same subscribe interface without changing the view.
  function extensionTransport(api) {
    return {
      subscribe(type, key, receive, empty) {
        let delivered = false;
        const listener = message => {
          if (message?.type !== type) return;
          delivered = true;
          receive(message);
        };
        api.runtime.onMessage.addListener(listener);
        api.storage.session.get(key, result => {
          // A newer live message wins over the startup storage snapshot.
          if (delivered) return;
          const stored = result?.[key];
          if (stored?.type === type) listener(stored);
          else empty();
        });
        return () => api.runtime.onMessage.removeListener(listener);
      },
    };
  }
  globalThis.HMReportBoundary = { fromLegacy, validate, diagnose, extensionTransport };
})();
