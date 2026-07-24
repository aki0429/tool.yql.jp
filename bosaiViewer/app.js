(function () {
  "use strict";

  const STORAGE_KEY = "deckspace.workspace.v1";
  const SKINS = {
    windows: "Windows 11",
    mac: "macOS",
    ubuntu: "Ubuntu",
    browser: "Browser"
  };
  const APPS = [
    {
      id: "overview",
      title: "Operations Center",
      description: "デスクの概要",
      category: "内蔵ウィジェット",
      icon: "D",
      kind: "widget",
      widget: "overview",
      skin: "browser"
    },
    {
      id: "clock",
      title: "World Clock",
      description: "複数都市の時刻",
      category: "内蔵ウィジェット",
      icon: "T",
      kind: "widget",
      widget: "clock",
      skin: "mac"
    },
    {
      id: "notes",
      title: "Desk Notes",
      description: "自動保存メモ",
      category: "内蔵ウィジェット",
      icon: "N",
      kind: "widget",
      widget: "notes",
      skin: "ubuntu"
    },
    {
      id: "launcher",
      title: "Tool Launcher",
      description: "サイト内ツール一覧",
      category: "内蔵ウィジェット",
      icon: "L",
      kind: "widget",
      widget: "launcher",
      skin: "browser"
    },
    {
      id: "capture",
      title: "Window Capture",
      description: "OS画面 / アプリ窓を共有",
      category: "OS画面",
      icon: "C",
      kind: "widget",
      widget: "capture",
      skin: "windows"
    },
    {
      id: "eqcopy",
      title: "Intensity Map",
      description: "市町村ごとの震度",
      category: "このサイトのツール",
      icon: "E",
      kind: "site",
      url: "../EqCopy/maxint/index.html",
      skin: "windows"
    },
    {
      id: "rivercam",
      title: "River Camera",
      description: "河川カメラ",
      category: "このサイトのツール",
      icon: "R",
      kind: "site",
      url: "../rivercam/index.html",
      skin: "browser"
    },
    {
      id: "nowcast",
      title: "Nowcast",
      description: "高解像度ナウキャスト",
      category: "このサイトのツール",
      icon: "W",
      kind: "site",
      url: "../nowc/index.html",
      skin: "windows"
    },
    {
      id: "traffic",
      title: "Traffic Map",
      description: "交通情報",
      category: "このサイトのツール",
      icon: "M",
      kind: "site",
      url: "../load_info_map/index.html",
      skin: "ubuntu"
    },
    {
      id: "seismograph",
      title: "Seismograph",
      description: "地震計ビューア",
      category: "このサイトのツール",
      icon: "S",
      kind: "site",
      url: "../EqMap_seismograph/index.html",
      skin: "mac"
    }
  ];

  const dom = {};
  let state;
  let idCounter = 0;
  let zCounter = 30;
  let draggedPaneId = null;
  let saveTimer = null;
  const liveStreams = new Map();

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    bindDom();
    state = readState() || createInitialState();
    normalizeState();
    bindEvents();
    renderLibrary("");
    renderAll();
    updateClocks();
    window.setInterval(updateClocks, 1000);
  }

  function bindDom() {
    dom.tabs = document.getElementById("workspace-tabs");
    dom.desktopName = document.getElementById("desktop-name");
    dom.surface = document.getElementById("desktop-surface");
    dom.layoutRoot = document.getElementById("layout-root");
    dom.floatingLayer = document.getElementById("floating-layer");
    dom.library = document.getElementById("app-library");
    dom.filter = document.getElementById("library-filter");
    dom.inspector = document.getElementById("inspector-content");
    dom.saveState = document.getElementById("save-state");
    dom.statusClock = document.getElementById("status-clock");
    dom.siteDialog = document.getElementById("site-dialog");
    dom.siteForm = document.getElementById("site-form");
    dom.siteDialogTitle = document.getElementById("site-dialog-title");
    dom.siteFormError = document.getElementById("site-form-error");
    dom.workspaceDialog = document.getElementById("workspace-dialog");
    dom.workspaceForm = document.getElementById("workspace-form");
    dom.toasts = document.getElementById("toast-stack");
  }

  function bindEvents() {
    document.addEventListener("click", function (event) {
      const workspaceTab = event.target.closest("[data-workspace-id]");
      if (workspaceTab) {
        activateWorkspace(workspaceTab.dataset.workspaceId);
        return;
      }

      const template = event.target.closest("[data-template]");
      if (template) {
        applyTemplateToCurrent(template.dataset.template);
        return;
      }

      const actionElement = event.target.closest("[data-action]");
      if (actionElement) {
        runAction(actionElement.dataset.action, actionElement);
      }
    });

    document.addEventListener("change", function (event) {
      if (event.target.id === "panel-skin") {
        const pane = currentWorkspace().panels[currentWorkspace().selectedPaneId];
        if (pane && SKINS[event.target.value]) {
          pane.skin = event.target.value;
          commitAndRender();
        }
      }
    });

    dom.filter.addEventListener("input", function () {
      renderLibrary(dom.filter.value);
    });

    dom.siteForm.addEventListener("submit", submitSiteForm);
    dom.workspaceForm.addEventListener("submit", submitWorkspaceForm);
  }

  function runAction(action, element) {
    switch (action) {
      case "new-workspace":
        dom.workspaceForm.reset();
        dom.workspaceDialog.showModal();
        break;
      case "close-workspace-dialog":
        dom.workspaceDialog.close();
        break;
      case "add-site":
        openSiteDialog(null, "dock");
        break;
      case "close-site-dialog":
        dom.siteDialog.close();
        break;
      case "launch-app":
        launchApp(element.dataset.appId, "dock");
        break;
      case "float-app":
        launchApp(element.dataset.appId, "float");
        break;
      case "split-row":
        splitSelected("row");
        break;
      case "split-column":
        splitSelected("column");
        break;
      case "open-floating":
      case "detach-pane":
        detachSelectedPanel(element.dataset.paneId);
        break;
      case "clear-pane":
        clearSelectedPanel(element.dataset.paneId);
        break;
      case "remove-pane":
        removePane(element.dataset.paneId);
        break;
      case "edit-site":
        editPanelSite(element.dataset.paneId, element.dataset.floatingId);
        break;
      case "close-floating":
        closeFloating(element.dataset.floatingId);
        break;
      case "dock-floating":
        dockFloating(element.dataset.floatingId);
        break;
      case "minimize-floating":
        toggleMinimizeFloating(element.dataset.floatingId);
        break;
      case "maximize-floating":
        toggleMaximizeFloating(element.dataset.floatingId);
        break;
      case "rename-workspace":
        renameWorkspace();
        break;
      case "delete-workspace":
        deleteWorkspace();
        break;
      default:
        break;
    }
  }

  function createInitialState() {
    const command = buildWorkspace("Command Deck", "command");
    const monitor = buildWorkspace("Bosai Monitor", "monitor");
    return {
      version: 1,
      activeWorkspaceId: command.id,
      workspaces: [command, monitor]
    };
  }

  function buildWorkspace(name, templateName) {
    const workspace = {
      id: uid("workspace"),
      name: name,
      layout: null,
      selectedPaneId: null,
      panels: {},
      floating: []
    };
    applyTemplate(workspace, templateName);
    return workspace;
  }

  function applyTemplate(workspace, templateName) {
    releaseWorkspaceStreams(workspace);
    workspace.panels = {};
    workspace.floating = [];

    if (templateName === "blank") {
      workspace.layout = createLeaf(workspace, null);
    } else if (templateName === "monitor") {
      const quake = createLeaf(workspace, "eqcopy");
      const river = createLeaf(workspace, "rivercam");
      const weather = createLeaf(workspace, "nowcast");
      const traffic = createLeaf(workspace, "traffic");
      workspace.layout = split(
        "row",
        split("column", quake, river, 54),
        split("column", weather, traffic, 50),
        50
      );
    } else {
      const overview = createLeaf(workspace, "overview");
      const clock = createLeaf(workspace, "clock");
      const notes = createLeaf(workspace, "notes");
      const launcher = createLeaf(workspace, "launcher");
      workspace.layout = split(
        "row",
        overview,
        split("column", clock, split("row", notes, launcher, 56), 44),
        62
      );
    }

    const leaves = collectLeaves(workspace.layout);
    workspace.selectedPaneId = leaves[0];
  }

  function createLeaf(workspace, appId) {
    const paneId = uid("pane");
    workspace.panels[paneId] = appId ? panelFromApp(appId) : emptyPanel();
    return { type: "leaf", paneId: paneId };
  }

  function split(direction, first, second, ratio) {
    return {
      type: "split",
      direction: direction,
      ratio: ratio || 50,
      first: first,
      second: second
    };
  }

  function emptyPanel() {
    return {
      instanceId: uid("panel"),
      title: "Empty Window",
      description: "コンテンツ未選択",
      icon: "+",
      kind: "empty",
      skin: "browser",
      data: {}
    };
  }

  function panelFromApp(appId) {
    const app = findApp(appId);
    if (!app) {
      return emptyPanel();
    }
    return {
      instanceId: uid("panel"),
      appId: app.id,
      title: app.title,
      description: app.description,
      icon: app.icon,
      kind: app.kind,
      widget: app.widget || null,
      url: app.url || null,
      skin: app.skin,
      data: app.widget === "notes" ? { notes: "" } : {}
    };
  }

  function customSitePanel(title, url, skin) {
    return {
      instanceId: uid("panel"),
      title: title,
      description: "カスタムサイト",
      icon: "U",
      kind: "site",
      url: url,
      skin: skin,
      data: {}
    };
  }

  function renderAll() {
    renderTabs();
    renderDesktop();
    renderInspector();
  }

  function renderTabs() {
    dom.tabs.replaceChildren();
    state.workspaces.forEach(function (workspace) {
      const tab = create("button", "workspace-tab");
      tab.type = "button";
      tab.dataset.workspaceId = workspace.id;
      tab.classList.toggle("active", workspace.id === state.activeWorkspaceId);
      tab.setAttribute("aria-current", workspace.id === state.activeWorkspaceId ? "page" : "false");
      tab.appendChild(create("span", "", workspace.name));
      dom.tabs.appendChild(tab);
    });
  }

  function renderLibrary(filterText) {
    const query = String(filterText || "").trim().toLowerCase();
    const filtered = APPS.filter(function (app) {
      return !query ||
        app.title.toLowerCase().includes(query) ||
        app.description.toLowerCase().includes(query) ||
        app.category.toLowerCase().includes(query);
    });

    dom.library.replaceChildren();
    let lastCategory = "";
    filtered.forEach(function (app) {
      if (app.category !== lastCategory) {
        dom.library.appendChild(create("p", "library-group", app.category));
        lastCategory = app.category;
      }

      const item = create("div", "library-item");
      const launch = create("button", "app-launch");
      launch.type = "button";
      launch.dataset.action = "launch-app";
      launch.dataset.appId = app.id;
      launch.title = app.title + " を選択中のペインに開く";
      launch.appendChild(create("span", "app-icon", app.icon));
      const copy = create("span");
      copy.appendChild(create("strong", "", app.title));
      copy.appendChild(create("small", "", app.description));
      launch.appendChild(copy);

      const floatButton = create("button", "float-launch", "↗");
      floatButton.type = "button";
      floatButton.dataset.action = "float-app";
      floatButton.dataset.appId = app.id;
      floatButton.title = "浮動ウィンドウで開く";
      floatButton.setAttribute("aria-label", app.title + "を浮動ウィンドウで開く");

      item.appendChild(launch);
      item.appendChild(floatButton);
      dom.library.appendChild(item);
    });

    if (!filtered.length) {
      dom.library.appendChild(create("p", "overview-copy", "一致するツールがありません。"));
    }
  }

  function renderDesktop() {
    const workspace = currentWorkspace();
    dom.desktopName.textContent = workspace.name;
    dom.layoutRoot.replaceChildren();
    dom.layoutRoot.appendChild(renderLayoutNode(workspace.layout, workspace));
    renderFloatingWindows(workspace);
  }

  function renderLayoutNode(node, workspace) {
    if (node.type === "leaf") {
      return renderPane(node.paneId, workspace);
    }

    const wrapper = create("div", "split-layout " + node.direction);
    const first = create("div", "split-child");
    const second = create("div", "split-child");
    const divider = create("div", "divider");
    divider.setAttribute("role", "separator");
    divider.setAttribute("aria-label", "ペインのサイズを変更");
    divider.tabIndex = 0;
    setSplitSizes(first, second, node.ratio);
    first.appendChild(renderLayoutNode(node.first, workspace));
    second.appendChild(renderLayoutNode(node.second, workspace));
    divider.addEventListener("pointerdown", function (event) {
      startDividerResize(event, node, wrapper, first, second, divider);
    });
    wrapper.append(first, divider, second);
    return wrapper;
  }

  function renderPane(paneId, workspace) {
    const pane = create("section", "pane");
    pane.dataset.paneId = paneId;
    pane.classList.toggle("selected", workspace.selectedPaneId === paneId);
    pane.addEventListener("pointerdown", function () {
      if (workspace.selectedPaneId !== paneId) {
        workspace.selectedPaneId = paneId;
        dom.layoutRoot.querySelectorAll(".pane").forEach(function (entry) {
          entry.classList.toggle("selected", entry.dataset.paneId === paneId);
        });
        renderInspector();
        persist();
      }
    });
    pane.addEventListener("dragover", function (event) {
      if (draggedPaneId && draggedPaneId !== paneId) {
        event.preventDefault();
        pane.classList.add("drop-target");
      }
    });
    pane.addEventListener("dragleave", function () {
      pane.classList.remove("drop-target");
    });
    pane.addEventListener("drop", function (event) {
      event.preventDefault();
      pane.classList.remove("drop-target");
      if (draggedPaneId && draggedPaneId !== paneId) {
        const sourcePanel = workspace.panels[draggedPaneId];
        workspace.panels[draggedPaneId] = workspace.panels[paneId];
        workspace.panels[paneId] = sourcePanel;
        workspace.selectedPaneId = paneId;
        draggedPaneId = null;
        dom.surface.classList.remove("moving-pane");
        commitAndRender();
        toast("ウィンドウを入れ替えました");
      }
    });

    const panel = workspace.panels[paneId] || emptyPanel();
    pane.appendChild(renderWindow(panel, { paneId: paneId }));
    return pane;
  }

  function renderWindow(panel, context) {
    const windowElement = create("article", "window skin-" + panel.skin);
    const titlebar = create("header", "window-titlebar");
    const controls = create("span", "chrome-controls");
    controls.append(create("span"), create("span"), create("span"));
    titlebar.appendChild(controls);
    titlebar.appendChild(create("span", "window-app-dot"));
    titlebar.appendChild(create("span", "window-title", panel.title));
    titlebar.appendChild(create("span", "window-subtitle", panel.description || ""));
    titlebar.appendChild(renderWindowActions(panel, context));

    if (context.paneId) {
      titlebar.draggable = true;
      titlebar.addEventListener("dragstart", function (event) {
        if (event.target.closest("button")) {
          event.preventDefault();
          return;
        }
        draggedPaneId = context.paneId;
        dom.surface.classList.add("moving-pane");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", context.paneId);
      });
      titlebar.addEventListener("dragend", function () {
        draggedPaneId = null;
        dom.surface.classList.remove("moving-pane");
        document.querySelectorAll(".drop-target").forEach(function (target) {
          target.classList.remove("drop-target");
        });
      });
    }

    const body = create("div", "window-body");
    body.appendChild(renderPanelContent(panel, context));
    windowElement.append(titlebar, body);
    return windowElement;
  }

  function renderWindowActions(panel, context) {
    const actions = create("div", "window-actions");
    if (context.floatingId) {
      if (panel.kind === "site") {
        actions.appendChild(windowAction("⋯", "edit-site", "URLを編集", context));
      }
      actions.appendChild(windowAction("⇲", "dock-floating", "選択中のペインに配置", context));
      actions.appendChild(windowAction("_", "minimize-floating", "最小化", context));
      actions.appendChild(windowAction("□", "maximize-floating", "最大化", context));
      actions.appendChild(windowAction("x", "close-floating", "閉じる", context, "danger"));
    } else {
      if (panel.kind === "site") {
        actions.appendChild(windowAction("⋯", "edit-site", "URLを編集", context));
      }
      actions.appendChild(windowAction("↗", "detach-pane", "浮動ウィンドウにする", context));
      actions.appendChild(windowAction("x", "clear-pane", "内容を閉じる", context, "danger"));
    }
    return actions;
  }

  function windowAction(label, action, title, context, extraClass) {
    const button = create("button", "window-action" + (extraClass ? " " + extraClass : ""), label);
    button.type = "button";
    button.dataset.action = action;
    if (context.paneId) {
      button.dataset.paneId = context.paneId;
    }
    if (context.floatingId) {
      button.dataset.floatingId = context.floatingId;
    }
    button.title = title;
    button.setAttribute("aria-label", title);
    return button;
  }

  function renderPanelContent(panel, context) {
    if (panel.kind === "empty") {
      const empty = create("div", "empty-window");
      empty.appendChild(create("div", "empty-symbol", "+"));
      empty.appendChild(create("h3", "", "ウィンドウを配置"));
      empty.appendChild(create("p", "", "左のライブラリから選択するか、任意のURLを追加してください。"));
      const actions = create("div", "empty-actions");
      actions.appendChild(actionButton("+ サイト", "add-site"));
      const overviewButton = actionButton("概要を開く", "launch-app");
      overviewButton.dataset.appId = "overview";
      actions.appendChild(overviewButton);
      empty.appendChild(actions);
      return empty;
    }

    if (panel.kind === "site") {
      return renderEmbed(panel);
    }

    switch (panel.widget) {
      case "clock":
        return renderClockWidget();
      case "notes":
        return renderNotesWidget(panel);
      case "launcher":
        return renderLauncherWidget();
      case "capture":
        return renderCaptureWidget(panel);
      default:
        return renderOverviewWidget();
    }
  }

  function renderOverviewWidget() {
    const wrapper = create("section", "widget overview");
    const heading = create("h3");
    heading.appendChild(document.createTextNode("すべての画面を、"));
    heading.appendChild(create("span", "", "一つのデスク"));
    heading.appendChild(document.createTextNode("に。"));
    wrapper.appendChild(heading);
    wrapper.appendChild(create(
      "p",
      "overview-copy",
      "サイト内ツールや表示可能なWebページを好きな形に分割し、調査・監視用のレイアウトをブラウザに保存できます。"
    ));

    const metrics = create("div", "metric-row");
    metrics.appendChild(metric("ペイン", String(collectLeaves(currentWorkspace().layout).length)));
    metrics.appendChild(metric("浮動窓", String(currentWorkspace().floating.length)));
    metrics.appendChild(metric("保存", "AUTO", "live"));
    wrapper.appendChild(metrics);

    const launches = create("div", "quick-launches");
    [
      ["OSウィンドウを共有", "capture"],
      ["地震情報を開く", "eqcopy"],
      ["河川カメラを開く", "rivercam"],
      ["メモを開く", "notes"]
    ].forEach(function (entry) {
      const button = create("button", "", entry[0]);
      button.type = "button";
      button.dataset.action = "launch-app";
      button.dataset.appId = entry[1];
      launches.appendChild(button);
    });
    wrapper.appendChild(launches);
    return wrapper;
  }

  function metric(label, value, className) {
    const element = create("div", "metric");
    element.appendChild(create("label", "", label));
    element.appendChild(create("strong", className || "", value));
    return element;
  }

  function renderClockWidget() {
    const wrapper = create("section", "widget clock-widget");
    const main = create("time", "clock-main");
    main.dataset.clockZone = "Asia/Tokyo";
    main.dataset.clockFormat = "time";
    const date = create("time", "clock-date");
    date.dataset.clockZone = "Asia/Tokyo";
    date.dataset.clockFormat = "date";
    wrapper.append(main, date);

    const zones = create("div", "zone-list");
    [
      ["UTC", "UTC"],
      ["London", "Europe/London"],
      ["New York", "America/New_York"]
    ].forEach(function (entry) {
      const row = create("div", "zone");
      row.appendChild(create("span", "", entry[0]));
      const time = create("time");
      time.dataset.clockZone = entry[1];
      time.dataset.clockFormat = "time";
      row.appendChild(time);
      zones.appendChild(row);
    });
    wrapper.appendChild(zones);
    window.setTimeout(updateClocks, 0);
    return wrapper;
  }

  function renderNotesWidget(panel) {
    const wrapper = create("section", "widget notes-widget");
    wrapper.appendChild(create("p", "", "このデスクに保存されるメモ"));
    const textarea = create("textarea");
    textarea.placeholder = "監視事項、URL、引き継ぎメモを入力...";
    textarea.value = panel.data.notes || "";
    textarea.addEventListener("input", function () {
      panel.data.notes = textarea.value;
      persist();
    });
    wrapper.appendChild(textarea);
    return wrapper;
  }

  function renderLauncherWidget() {
    const wrapper = create("section", "widget launcher-widget");
    wrapper.appendChild(create("h3", "", "サイト内ツール"));
    APPS.filter(function (app) {
      return app.kind === "site";
    }).forEach(function (app) {
      const row = create("div", "launcher-link");
      const text = create("div");
      text.appendChild(create("strong", "", app.title));
      text.appendChild(create("small", "", app.url));
      row.appendChild(text);
      const button = actionButton("開く", "launch-app");
      button.dataset.appId = app.id;
      row.appendChild(button);
      wrapper.appendChild(row);
    });
    return wrapper;
  }

  function renderCaptureWidget(panel) {
    const wrapper = create("section", "widget capture-widget");
    const stream = liveStreams.get(panel.instanceId);
    const preview = create("div", "capture-preview");
    if (stream) {
      const video = document.createElement("video");
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      preview.appendChild(video);
    } else {
      preview.appendChild(create("div", "capture-placeholder", "共有するウィンドウを選択"));
    }
    wrapper.appendChild(preview);

    const controls = create("div", "capture-controls");
    const button = create("button", "action-button", stream ? "共有を選び直す" : "ウィンドウ共有を開始");
    button.type = "button";
    button.addEventListener("click", function () {
      beginCapture(panel);
    });
    controls.appendChild(button);
    if (stream) {
      const stop = create("button", "toolbar-button", "停止");
      stop.type = "button";
      stop.addEventListener("click", function () {
        stopCapture(panel.instanceId);
        renderDesktop();
      });
      controls.appendChild(stop);
    }
    wrapper.appendChild(controls);
    wrapper.appendChild(create(
      "p",
      "capture-help",
      "ブラウザの共有ダイアログで、画面全体・アプリのウィンドウ・タブのいずれかを選択できます。"
    ));
    return wrapper;
  }

  function renderEmbed(panel) {
    const wrapper = create("section", "embed");
    const bar = create("div", "embed-bar");
    bar.appendChild(create("span", "embed-url", panel.url));
    const open = create("a", "external-link", "別タブ ↗");
    open.href = safeUrl(panel.url) || "about:blank";
    open.target = "_blank";
    open.rel = "noopener noreferrer";
    open.title = "埋め込み表示できない場合はこちらから開く";
    bar.appendChild(open);
    const frame = document.createElement("iframe");
    frame.title = panel.title;
    frame.src = safeUrl(panel.url) || "about:blank";
    frame.loading = "lazy";
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    frame.allow = "fullscreen; geolocation";
    wrapper.append(bar, frame);
    return wrapper;
  }

  function renderFloatingWindows(workspace) {
    dom.floatingLayer.replaceChildren();
    workspace.floating.forEach(function (floating) {
      const outer = create("section", "floating-window");
      outer.dataset.floatingId = floating.id;
      outer.classList.toggle("maximized", Boolean(floating.maximized));
      outer.classList.toggle("minimized", Boolean(floating.minimized));
      applyFloatingGeometry(outer, floating);
      outer.style.zIndex = String(floating.z || 10);
      outer.addEventListener("pointerdown", function () {
        bringFloatingToFront(floating, outer);
      });

      const content = renderWindow(floating.panel, { floatingId: floating.id });
      const titlebar = content.querySelector(".window-titlebar");
      titlebar.addEventListener("pointerdown", function (event) {
        if (!event.target.closest("button")) {
          startFloatingMove(event, floating, outer, titlebar);
        }
      });
      outer.appendChild(content);
      dom.floatingLayer.appendChild(outer);

      if (window.ResizeObserver) {
        const observer = new ResizeObserver(function () {
          if (!floating.maximized && !floating.minimized && outer.isConnected) {
            floating.width = Math.round(outer.offsetWidth);
            floating.height = Math.round(outer.offsetHeight);
            persist();
          }
        });
        observer.observe(outer);
      }
    });
  }

  function renderInspector() {
    const workspace = currentWorkspace();
    const panel = workspace.panels[workspace.selectedPaneId] || emptyPanel();
    dom.inspector.replaceChildren();

    const title = create("div", "inspect-title");
    title.appendChild(create("span", "app-icon", panel.icon || "+"));
    const titleCopy = create("div");
    titleCopy.appendChild(create("h3", "", panel.title));
    titleCopy.appendChild(create("p", "", panel.description || "コンテンツ未選択"));
    title.appendChild(titleCopy);
    dom.inspector.appendChild(title);

    const skinLabel = create("label", "inspect-field", "ウィンドウ外観");
    const select = document.createElement("select");
    select.id = "panel-skin";
    Object.keys(SKINS).forEach(function (skin) {
      const option = document.createElement("option");
      option.value = skin;
      option.textContent = SKINS[skin];
      option.selected = panel.skin === skin;
      select.appendChild(option);
    });
    skinLabel.appendChild(select);
    dom.inspector.appendChild(skinLabel);

    const actions = create("div", "inspect-actions");
    actions.appendChild(actionButton("左右分割", "split-row", "toolbar-button"));
    actions.appendChild(actionButton("上下分割", "split-column", "toolbar-button"));
    actions.appendChild(actionButton("浮動窓にする", "detach-pane", "toolbar-button"));
    if (panel.kind === "site") {
      const edit = actionButton("URLを編集", "edit-site", "toolbar-button");
      edit.dataset.paneId = workspace.selectedPaneId;
      actions.appendChild(edit);
    } else {
      actions.appendChild(actionButton("サイトを追加", "add-site", "toolbar-button"));
    }
    const remove = actionButton(
      collectLeaves(workspace.layout).length === 1 ? "内容をクリア" : "ペインを削除",
      collectLeaves(workspace.layout).length === 1 ? "clear-pane" : "remove-pane",
      "toolbar-button"
    );
    actions.appendChild(remove);
    dom.inspector.appendChild(actions);

    const deskActions = create("div", "inspect-actions");
    deskActions.appendChild(actionButton("デスク名変更", "rename-workspace", "toolbar-button"));
    deskActions.appendChild(actionButton("デスク削除", "delete-workspace", "toolbar-button"));
    dom.inspector.appendChild(deskActions);
  }

  function launchApp(appId, mode) {
    const panel = panelFromApp(appId);
    if (mode === "float") {
      addFloating(panel);
      toast(panel.title + " を浮動ウィンドウで開きました");
    } else {
      assignToSelected(panel);
    }
    commitAndRender();
  }

  function assignToSelected(panel) {
    const workspace = currentWorkspace();
    releasePanelStream(workspace.panels[workspace.selectedPaneId]);
    workspace.panels[workspace.selectedPaneId] = panel;
  }

  function splitSelected(direction) {
    const workspace = currentWorkspace();
    const selectedId = workspace.selectedPaneId;
    const newLeaf = createLeaf(workspace, null);
    workspace.layout = replaceLeaf(
      workspace.layout,
      selectedId,
      split(direction, { type: "leaf", paneId: selectedId }, newLeaf, 50)
    );
    workspace.selectedPaneId = newLeaf.paneId;
    commitAndRender();
  }

  function clearSelectedPanel(paneId) {
    const workspace = currentWorkspace();
    const targetId = paneId || workspace.selectedPaneId;
    workspace.selectedPaneId = targetId;
    releasePanelStream(workspace.panels[targetId]);
    workspace.panels[targetId] = emptyPanel();
    commitAndRender();
  }

  function removePane(paneId) {
    const workspace = currentWorkspace();
    const targetId = paneId || workspace.selectedPaneId;
    const leaves = collectLeaves(workspace.layout);
    if (leaves.length < 2) {
      clearSelectedPanel(targetId);
      return;
    }
    releasePanelStream(workspace.panels[targetId]);
    workspace.layout = deleteLeaf(workspace.layout, targetId);
    delete workspace.panels[targetId];
    workspace.selectedPaneId = collectLeaves(workspace.layout)[0];
    commitAndRender();
  }

  function detachSelectedPanel(paneId) {
    const workspace = currentWorkspace();
    const targetId = paneId || workspace.selectedPaneId;
    const panel = workspace.panels[targetId];
    if (!panel || panel.kind === "empty") {
      openSiteDialog(null, "float");
      return;
    }
    addFloating(clone(panel));
    workspace.panels[targetId] = emptyPanel();
    workspace.selectedPaneId = targetId;
    commitAndRender();
    toast(panel.title + " を浮動ウィンドウにしました");
  }

  function addFloating(panel) {
    const workspace = currentWorkspace();
    const offset = workspace.floating.length % 6;
    const width = Math.min(560, Math.max(300, dom.surface.clientWidth * 0.5));
    const height = Math.min(430, Math.max(210, dom.surface.clientHeight * 0.56));
    const floating = {
      id: uid("floating"),
      panel: panel,
      x: 32 + (offset * 24),
      y: 32 + (offset * 22),
      width: Math.round(width),
      height: Math.round(height),
      z: ++zCounter,
      minimized: false,
      maximized: false,
      restore: null
    };
    workspace.floating.push(floating);
    return floating;
  }

  function closeFloating(id) {
    const workspace = currentWorkspace();
    const closing = findFloating(id);
    if (closing) {
      releasePanelStream(closing.panel);
    }
    workspace.floating = workspace.floating.filter(function (item) {
      return item.id !== id;
    });
    commitAndRender();
  }

  function dockFloating(id) {
    const workspace = currentWorkspace();
    const index = workspace.floating.findIndex(function (item) {
      return item.id === id;
    });
    if (index < 0) {
      return;
    }
    const floating = workspace.floating[index];
    const displaced = workspace.panels[workspace.selectedPaneId];
    workspace.panels[workspace.selectedPaneId] = floating.panel;
    if (displaced && displaced.kind !== "empty") {
      floating.panel = displaced;
      floating.maximized = false;
      floating.minimized = false;
      toast("元の内容を浮動ウィンドウに退避しました");
    } else {
      workspace.floating.splice(index, 1);
    }
    commitAndRender();
  }

  function toggleMinimizeFloating(id) {
    const floating = findFloating(id);
    if (!floating) {
      return;
    }
    floating.minimized = !floating.minimized;
    floating.maximized = false;
    commitAndRender();
  }

  function toggleMaximizeFloating(id) {
    const floating = findFloating(id);
    if (!floating) {
      return;
    }
    if (!floating.maximized) {
      floating.restore = {
        x: floating.x,
        y: floating.y,
        width: floating.width,
        height: floating.height
      };
      floating.maximized = true;
      floating.minimized = false;
    } else {
      Object.assign(floating, floating.restore || {});
      floating.maximized = false;
    }
    commitAndRender();
  }

  function applyFloatingGeometry(element, floating) {
    if (floating.maximized) {
      element.style.left = "6px";
      element.style.top = "6px";
      element.style.width = "calc(100% - 12px)";
      element.style.height = "calc(100% - 12px)";
      return;
    }
    element.style.left = floating.x + "px";
    element.style.top = floating.y + "px";
    element.style.width = floating.width + "px";
    element.style.height = floating.minimized ? "39px" : floating.height + "px";
  }

  function bringFloatingToFront(floating, element) {
    floating.z = ++zCounter;
    element.style.zIndex = String(floating.z);
    persist();
  }

  function startFloatingMove(event, floating, element, handle) {
    if (event.button !== 0 || floating.maximized) {
      return;
    }
    event.preventDefault();
    bringFloatingToFront(floating, element);
    const originX = event.clientX;
    const originY = event.clientY;
    const startX = floating.x;
    const startY = floating.y;
    handle.setPointerCapture(event.pointerId);

    function move(moveEvent) {
      const maxX = Math.max(0, dom.surface.clientWidth - 130);
      const maxY = Math.max(0, dom.surface.clientHeight - 39);
      floating.x = clamp(startX + moveEvent.clientX - originX, 0, maxX);
      floating.y = clamp(startY + moveEvent.clientY - originY, 0, maxY);
      element.style.left = floating.x + "px";
      element.style.top = floating.y + "px";
    }

    function stop() {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
      persist();
    }

    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  }

  function startDividerResize(event, node, wrapper, first, second, divider) {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    divider.classList.add("dragging");
    divider.setPointerCapture(event.pointerId);

    function move(moveEvent) {
      const bounds = wrapper.getBoundingClientRect();
      const raw = node.direction === "row"
        ? ((moveEvent.clientX - bounds.left) / bounds.width) * 100
        : ((moveEvent.clientY - bounds.top) / bounds.height) * 100;
      node.ratio = clamp(raw, 16, 84);
      setSplitSizes(first, second, node.ratio);
    }

    function stop() {
      divider.classList.remove("dragging");
      divider.removeEventListener("pointermove", move);
      divider.removeEventListener("pointerup", stop);
      divider.removeEventListener("pointercancel", stop);
      persist();
    }

    divider.addEventListener("pointermove", move);
    divider.addEventListener("pointerup", stop);
    divider.addEventListener("pointercancel", stop);
  }

  function setSplitSizes(first, second, ratio) {
    first.style.flex = "0 1 calc(" + ratio + "% - 4px)";
    second.style.flex = "0 1 calc(" + (100 - ratio) + "% - 4px)";
  }

  function openSiteDialog(panel, mode, context) {
    dom.siteForm.reset();
    dom.siteFormError.textContent = "";
    dom.siteForm.dataset.target = context && context.target ? context.target : "";
    dom.siteForm.dataset.targetId = context && context.id ? context.id : "";
    dom.siteDialogTitle.textContent = panel ? "サイトを編集" : "サイトを追加";
    if (panel) {
      dom.siteForm.elements.title.value = panel.title;
      dom.siteForm.elements.url.value = panel.url;
      dom.siteForm.elements.skin.value = panel.skin;
      dom.siteForm.elements.mode.value = context && context.target === "floating" ? "float" : "dock";
      dom.siteForm.elements.mode.disabled = true;
    } else {
      dom.siteForm.elements.skin.value = "windows";
      dom.siteForm.elements.mode.value = mode || "dock";
      dom.siteForm.elements.mode.disabled = false;
    }
    dom.siteDialog.showModal();
  }

  function submitSiteForm(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const title = form.elements.title.value.trim();
    const url = normalizeInputUrl(form.elements.url.value);
    const skin = form.elements.skin.value;
    if (!url) {
      dom.siteFormError.textContent = "http(s) URL またはサイト内の相対パスを入力してください。";
      return;
    }
    const panel = customSitePanel(title, url, SKINS[skin] ? skin : "windows");
    const target = form.dataset.target;
    const targetId = form.dataset.targetId;

    if (target === "pane") {
      currentWorkspace().panels[targetId] = panel;
    } else if (target === "floating") {
      const floating = findFloating(targetId);
      if (floating) {
        floating.panel = panel;
      }
    } else if (form.elements.mode.value === "float") {
      addFloating(panel);
    } else {
      assignToSelected(panel);
    }

    form.elements.mode.disabled = false;
    dom.siteDialog.close();
    commitAndRender();
  }

  function editPanelSite(paneId, floatingId) {
    if (floatingId) {
      const floating = findFloating(floatingId);
      if (floating && floating.panel.kind === "site") {
        openSiteDialog(floating.panel, "float", { target: "floating", id: floatingId });
      }
      return;
    }
    const id = paneId || currentWorkspace().selectedPaneId;
    const panel = currentWorkspace().panels[id];
    if (panel && panel.kind === "site") {
      openSiteDialog(panel, "dock", { target: "pane", id: id });
    }
  }

  function submitWorkspaceForm(event) {
    event.preventDefault();
    const name = dom.workspaceForm.elements.name.value.trim();
    const templateName = dom.workspaceForm.elements.template.value;
    const workspace = buildWorkspace(name, templateName);
    state.workspaces.push(workspace);
    state.activeWorkspaceId = workspace.id;
    dom.workspaceDialog.close();
    commitAndRender();
    toast(name + " を作成しました");
  }

  function activateWorkspace(id) {
    if (state.workspaces.some(function (workspace) { return workspace.id === id; })) {
      if (id !== state.activeWorkspaceId) {
        releaseWorkspaceStreams(currentWorkspace());
      }
      state.activeWorkspaceId = id;
      commitAndRender();
    }
  }

  function applyTemplateToCurrent(templateName) {
    const workspace = currentWorkspace();
    if (!window.confirm("「" + workspace.name + "」の現在の配置をテンプレートで置き換えますか？")) {
      return;
    }
    applyTemplate(workspace, templateName);
    commitAndRender();
    toast("レイアウトを切り替えました");
  }

  function renameWorkspace() {
    const workspace = currentWorkspace();
    const name = window.prompt("デスク名を入力してください", workspace.name);
    if (name && name.trim()) {
      workspace.name = name.trim().slice(0, 32);
      commitAndRender();
    }
  }

  function deleteWorkspace() {
    const workspace = currentWorkspace();
    if (state.workspaces.length === 1) {
      toast("最後のデスクは削除できません");
      return;
    }
    if (!window.confirm("「" + workspace.name + "」を削除しますか？")) {
      return;
    }
    releaseWorkspaceStreams(workspace);
    state.workspaces = state.workspaces.filter(function (entry) {
      return entry.id !== workspace.id;
    });
    state.activeWorkspaceId = state.workspaces[0].id;
    commitAndRender();
  }

  function commitAndRender() {
    persist();
    renderAll();
  }

  function persist() {
    dom.saveState.textContent = "保存中...";
    dom.saveState.style.color = "var(--warning)";
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(function () {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        dom.saveState.textContent = "保存済み";
        dom.saveState.style.color = "var(--success)";
      } catch (error) {
        dom.saveState.textContent = "保存不可";
        dom.saveState.style.color = "var(--danger)";
      }
    }, 80);
  }

  function readState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const saved = JSON.parse(raw);
      return saved && Array.isArray(saved.workspaces) ? saved : null;
    } catch (error) {
      return null;
    }
  }

  function normalizeState() {
    if (!state.workspaces.length) {
      state = createInitialState();
    }
    if (!state.workspaces.some(function (workspace) {
      return workspace.id === state.activeWorkspaceId;
    })) {
      state.activeWorkspaceId = state.workspaces[0].id;
    }
    state.workspaces.forEach(function (workspace) {
      workspace.floating = Array.isArray(workspace.floating) ? workspace.floating : [];
      workspace.panels = workspace.panels || {};
      const leaves = collectLeaves(workspace.layout);
      if (!leaves.length) {
        applyTemplate(workspace, "blank");
        return;
      }
      leaves.forEach(function (paneId) {
        if (!workspace.panels[paneId]) {
          workspace.panels[paneId] = emptyPanel();
        }
        if (!workspace.panels[paneId].instanceId) {
          workspace.panels[paneId].instanceId = uid("panel");
        }
      });
      workspace.floating.forEach(function (floating) {
        if (floating.panel && !floating.panel.instanceId) {
          floating.panel.instanceId = uid("panel");
        }
      });
      if (!leaves.includes(workspace.selectedPaneId)) {
        workspace.selectedPaneId = leaves[0];
      }
    });
  }

  function currentWorkspace() {
    return state.workspaces.find(function (workspace) {
      return workspace.id === state.activeWorkspaceId;
    });
  }

  function findFloating(id) {
    return currentWorkspace().floating.find(function (floating) {
      return floating.id === id;
    });
  }

  function findApp(id) {
    return APPS.find(function (app) {
      return app.id === id;
    });
  }

  function replaceLeaf(node, paneId, replacement) {
    if (node.type === "leaf") {
      return node.paneId === paneId ? replacement : node;
    }
    node.first = replaceLeaf(node.first, paneId, replacement);
    node.second = replaceLeaf(node.second, paneId, replacement);
    return node;
  }

  function deleteLeaf(node, paneId) {
    if (node.type === "leaf") {
      return node;
    }
    if (node.first.type === "leaf" && node.first.paneId === paneId) {
      return node.second;
    }
    if (node.second.type === "leaf" && node.second.paneId === paneId) {
      return node.first;
    }
    node.first = deleteLeaf(node.first, paneId);
    node.second = deleteLeaf(node.second, paneId);
    return node;
  }

  function collectLeaves(node) {
    if (!node) {
      return [];
    }
    if (node.type === "leaf") {
      return [node.paneId];
    }
    return collectLeaves(node.first).concat(collectLeaves(node.second));
  }

  function normalizeInputUrl(rawValue) {
    const raw = String(rawValue || "").trim();
    if (!raw) {
      return null;
    }
    if (/^(?:\/(?!\/)|\.\.?\/)/.test(raw)) {
      return raw;
    }
    const withProtocol = /^[a-z][a-z\d+.-]*:/i.test(raw) || raw.startsWith("//")
      ? raw
      : "https://" + raw;
    try {
      const url = new URL(withProtocol, window.location.href);
      if (url.protocol === "https:" || url.protocol === "http:") {
        return url.href;
      }
    } catch (error) {
      return null;
    }
    return null;
  }

  async function beginCapture(panel) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      toast("このブラウザまたは接続方法では画面共有を利用できません");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false
      });
      if (!hasVisiblePanel(panel.instanceId)) {
        stream.getTracks().forEach(function (track) { track.stop(); });
        return;
      }
      stopCapture(panel.instanceId);
      liveStreams.set(panel.instanceId, stream);
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.addEventListener("ended", function () {
          if (liveStreams.get(panel.instanceId) === stream) {
            liveStreams.delete(panel.instanceId);
            renderDesktop();
          }
        });
      }
      renderDesktop();
      toast("共有ウィンドウを表示しています");
    } catch (error) {
      if (error && error.name !== "NotAllowedError") {
        toast("ウィンドウ共有を開始できませんでした");
      }
    }
  }

  function stopCapture(instanceId) {
    const stream = liveStreams.get(instanceId);
    if (!stream) {
      return;
    }
    liveStreams.delete(instanceId);
    stream.getTracks().forEach(function (track) {
      track.stop();
    });
  }

  function releasePanelStream(panel) {
    if (panel && panel.instanceId) {
      stopCapture(panel.instanceId);
    }
  }

  function releaseWorkspaceStreams(workspace) {
    if (!workspace) {
      return;
    }
    Object.keys(workspace.panels || {}).forEach(function (paneId) {
      releasePanelStream(workspace.panels[paneId]);
    });
    (workspace.floating || []).forEach(function (floating) {
      releasePanelStream(floating.panel);
    });
  }

  function hasVisiblePanel(instanceId) {
    const workspace = currentWorkspace();
    return Object.keys(workspace.panels || {}).some(function (paneId) {
      return workspace.panels[paneId].instanceId === instanceId;
    }) || (workspace.floating || []).some(function (floating) {
      return floating.panel.instanceId === instanceId;
    });
  }

  function safeUrl(rawUrl) {
    return normalizeInputUrl(rawUrl);
  }

  function updateClocks() {
    const now = new Date();
    document.querySelectorAll("[data-clock-zone]").forEach(function (clock) {
      const isDate = clock.dataset.clockFormat === "date";
      clock.textContent = new Intl.DateTimeFormat("ja-JP", isDate
        ? {
            dateStyle: "full",
            timeZone: clock.dataset.clockZone
          }
        : {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
            timeZone: clock.dataset.clockZone
          }).format(now);
    });
    dom.statusClock.textContent = new Intl.DateTimeFormat("ja-JP", {
      dateStyle: "medium",
      timeStyle: "medium",
      timeZone: "Asia/Tokyo"
    }).format(now) + " JST";
  }

  function toast(message) {
    const item = create("div", "toast", message);
    dom.toasts.appendChild(item);
    window.setTimeout(function () {
      item.remove();
    }, 2500);
  }

  function actionButton(label, action, className) {
    const button = create("button", className || "toolbar-button", label);
    button.type = "button";
    button.dataset.action = action;
    return button;
  }

  function create(tag, className, text) {
    const element = document.createElement(tag);
    if (className) {
      element.className = className;
    }
    if (text !== undefined) {
      element.textContent = text;
    }
    return element;
  }

  function uid(prefix) {
    idCounter += 1;
    return prefix + "-" + Date.now().toString(36) + "-" + idCounter.toString(36);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function clamp(number, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, number));
  }
}());
