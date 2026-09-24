(() => {
  const shared = window.ArcusShared;
  const workbench = "#!/pharmacy/dispenseworkbench/pharmacy/dispense";
  const fixture = window.allocateFixture = { scenario: {}, allocateClicks: 0, saves: 0, optionClicks: 0, closes: 0 };
  const host = document.createElement("div");
  host.id = "allocation-fixture";
  document.body.appendChild(host);
  const style = document.createElement("style");
  style.textContent = "md-dialog{display:block;position:fixed;top:20px;left:20px;width:400px;padding:20px;background:white;z-index:999999}md-select,md-select-value,md-option{display:block;min-height:28px;padding:6px}.md-select-menu-container{position:fixed;top:150px;left:30px;width:250px;z-index:1000000;background:white}button{min-width:75px;min-height:30px}";
  document.head.appendChild(style);
  fixture.reset = (scenario = {}) => {
    fixture.scenario = scenario;
    fixture.allocateClicks = fixture.saves = fixture.optionClicks = fixture.closes = 0;
    document.querySelectorAll("md-dialog,.md-select-menu-container").forEach(el => el.remove());
    location.hash = workbench;
    host.innerHTML = '<button id="fixture-row">Synthetic order</button><button id="allocatedispense">Allocate toolbar</button><div id="actiondiv"><button id="fixture-allocate" class="md-primary md-button md-incustheme-theme md-ink-ripple" type="button" ng-transclude="" ng-disabled="vm.allocatedisabled" aria-label="Allocate" ng-click="vm.saveData()"><md-icon md-font-icon="fa fa-save" class="ng-scope md-incustheme-theme md-font material-icons fa fa-save" aria-hidden="true"></md-icon><span translate="" class="ng-scope">Allocate</span><div class="md-ripple-container"></div></button></div>';
    host.insertAdjacentHTML("beforeend", '<button id="searchdispense">Search</button><table><tbody><tr id="slectDispense1">' +
      Array.from({length:10}, (_,index) => '<td>' + (index === 7 ? 'Ordered' : index === 8 ? 'DAILY ORDER' : index === 9 ? 'I-SYNTHETIC' : 'Fixture') + '</td>').join('') + '</tr></tbody></table>');
    fixture.searches = 0;
    host.querySelector("#searchdispense").onclick = () => {
      fixture.searches++;
      if (fixture.scenario.autoOnce && fixture.searches > 1) shared.state.stopRequested = true;
    };
    host.querySelector("#fixture-row").onclick = () => {
      if (fixture.scenario.infoRow) setTimeout(fixture.openInfoAlert, 100);
    };
    host.querySelector("#slectDispense1").onclick = host.querySelector("#fixture-row").onclick;
    host.querySelector("#allocatedispense").onclick = () => {
      location.hash = "#!/pharmacy/allocatedispense";
      const button = host.querySelector("#fixture-allocate");
      button.disabled = true;
      setTimeout(() => { button.disabled = false; }, 300);
      if (fixture.scenario.infoAllocation) setTimeout(fixture.openInfoAlert, 100);
    };
    host.querySelector("#fixture-allocate").onclick = () => {
      fixture.allocateClicks++;
      if (!fixture.scenario.noDialog) setTimeout(fixture.openDialog, 40);
    };
    Object.assign(shared.state.settings, { automationMode: "semi", waitManualOverride: false });
    shared.state.stopRequested = false;
  };
  fixture.openInfoAlert = () => {
    const dialog = document.createElement("md-dialog");
    dialog.setAttribute("aria-label", "Alerts");
    dialog.innerHTML = '<h2>Alerts</h2><p>Reason for admission: synthetic informational message</p><button id="closeBtn" aria-label="Close">Close</button>';
    dialog.querySelector("#closeBtn").onclick = () => { fixture.closes++; dialog.remove(); };
    document.body.appendChild(dialog);
  };
  fixture.openDialog = () => {
    const dialog = document.createElement("md-dialog");
    dialog.setAttribute("aria-label", "Alerts");
    dialog.innerHTML = '<md-toolbar><h2 class="ng-binding">Synthetic medicine</h2></md-toolbar>' +
      '<table class="order-table"><tbody><tr><td>Duplicate therapy warning</td></tr></tbody></table>' +
      '<button id="closeBtn" aria-label="Close">Close</button>' +
      '<md-select class="ng-empty" ng-model="vm.pharmacyoverridereasonuid" aria-label="Pharmacy Override Reason" aria-expanded="false" aria-owns="fixture-menu"><md-select-value class="md-select-placeholder">Pharmacy Override Reason</md-select-value></md-select>' +
      '<md-dialog-actions><button aria-label="Save" ng-click="vm.saveData()" disabled>Save</button></md-dialog-actions>';
    if (fixture.scenario.allergy) dialog.querySelector("tr").className = "drugallergybackground";
    dialog.querySelector("#closeBtn").onclick = () => { fixture.closes++; dialog.remove(); };
    const select = dialog.querySelector("md-select"), value = select.querySelector("md-select-value"), save = dialog.querySelector("[aria-label=Save]");
    const menu = document.createElement("div");
    menu.id = "fixture-menu";
    menu.className = "md-select-menu-container";
    menu.style.display = "none";
    menu.innerHTML = "<md-select-menu><md-option>" + (fixture.scenario.missing ? "Other reason" : "Medically needed") + "</md-option></md-select-menu>";
    const hidden = document.createElement("div");
    hidden.className = "md-select-menu-container";
    hidden.style.display = "none";
    hidden.innerHTML = "<md-select-menu><md-option>Medically needed</md-option></md-select-menu>";
    document.body.append(hidden, menu, dialog);
    value.onclick = () => {
      select.setAttribute("aria-expanded", "true");
      menu.style.display = "block";
      if (fixture.scenario.stopDuringMenu) {
        menu.style.pointerEvents = "none";
        setTimeout(() => {
          shared.state.stopRequested = true;
          window.ArcusAutoOverride.cancelPending();
          menu.style.pointerEvents = "";
        }, 100);
      }
    };
    menu.querySelector("md-option").onclick = () => {
      fixture.optionClicks++;
      if (!fixture.scenario.rejectSelection) {
        value.className = "";
        value.innerHTML = '<span class="md-text">Medically needed</span>';
        select.className = "ng-not-empty";
        save.disabled = false;
      }
      select.setAttribute("aria-expanded", "false");
      menu.style.display = "none";
    };
    if (fixture.scenario.rejectSelection) {
      value.className = "";
      value.innerHTML = '<span class="md-text">Doctor is Aware</span>';
      select.className = "ng-not-empty";
      save.disabled = false;
    }
    save.onclick = () => {
      fixture.saves++;
      dialog.remove();
      menu.remove();
      if (!fixture.scenario.noReturn) setTimeout(() => { location.hash = workbench; }, fixture.scenario.delay || 100);
    };
    return dialog;
  };
  shared.isWorkbenchPage = () => location.hash === workbench;
  shared.waitForWorkbenchReady = async () => shared.isWorkbenchPage();
  shared.getRowSnapshots = () => [{text:"Synthetic order",rowType:"daily"}];
  shared.findRowBySnapshot = () => document.querySelector("#fixture-row");
  shared.CONFIG.maxRouteWaitMs = 6000;
  shared.CONFIG.maxManualOverrideWaitMs = 6000;
  fixture.reset();
})();