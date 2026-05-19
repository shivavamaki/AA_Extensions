"use strict";

// URL utilities, request payload parsing, and shared cell helpers.
window.JasperShared = (() => {
  const TARGET_REPORT_UNIT = '/BDMS/Pharmacy/ipdsticker';
  const STORAGE_KEY        = 'lastJasperStickerCapture';
  const SUMMARY_KEY        = 'lastCaptureSummary';

  const JASPER_HOSTS = ['aa-report.bdms.co.th', 'aa-report-uat.bdms.co.th'];

  function safeUrl(href) {
    try { return new URL(href); } catch { return null; }
  }

  function isTargetJasperUrl(href) {
    const url = safeUrl(href);
    if (!url) return false;
    return (
      JASPER_HOSTS.includes(url.hostname) &&
      url.pathname.includes('/jasperserver/flow.html') &&
      url.searchParams.get('reportUnit') === TARGET_REPORT_UNIT
    );
  }

  function makeExcelUrl(href) {
    const url = safeUrl(href);
    if (!url || !isTargetJasperUrl(href)) return null;
    url.searchParams.set('output', 'xls');
    return url.toString();
  }

  function parseRequestPayload(href) {
    const p = new URL(href).searchParams;
    return {
      capturedAt:          new Date().toISOString(),
      sourcePageUrl:       location.href,
      xlsUrl:              href,
      reportUnit:          p.get('reportUnit')         || '',
      output:              p.get('output')             || '',
      patientuid:          p.get('patientuid')         || '',
      patientvisituid:     p.get('patientvisituid')    || '',
      searchcriteria:      p.get('searchcriteria')     || '',
      searchstring:        (p.get('searchstring') || '').split(',').filter(Boolean),
      agreementuid:        p.get('agreementuid')       || '',
      isduplicate:         p.get('isduplicate') === 'true',
      fromdate:            p.get('fromdate')           || '',
      todate:              p.get('todate')             || '',
      loginuid:            p.get('loginuid')           || '',
      organisationuid:     p.get('organisationuid')    || '',
      parentorguid:        p.get('parentorguid')       || '',
      userLocale:          p.get('userLocale')         || '',
      reporttemplateuid:   p.get('reporttemplateuid')  || '',
      logindepartmentuid:  p.get('logindepartmentuid') || '',
      pp:                  p.get('pp')                 || '',
    };
  }

  function decodeHtmlEntities(value) {
    const el = document.createElement('textarea');
    el.innerHTML = value;
    return el.value;
  }

  function cleanupCell(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  return {
    TARGET_REPORT_UNIT,
    STORAGE_KEY,
    SUMMARY_KEY,
    JASPER_HOSTS,
    safeUrl,
    isTargetJasperUrl,
    makeExcelUrl,
    parseRequestPayload,
    decodeHtmlEntities,
    cleanupCell,
  };
})();
