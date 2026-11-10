import {eventBus, ElsaPlugin} from "../services";
import {EventTypes} from "../models";
import {
  ActivityEditorAppearingEventArgs,
  ActivityEditorDisappearingEventArgs
} from "../components/screens/workflow-definition-editor/elsa-activity-editor-modal/elsa-activity-editor-modal";

export class SendHttpRequestPlugin implements ElsaPlugin {
  private attachTimer?: any;
  private readContentEl?: HTMLElement | null;
  private parserListEl?: HTMLElement | null;

  constructor() {
    eventBus.on(EventTypes.ActivityEditor.Appearing, this.onActivityEditorAppearing);
    eventBus.on(EventTypes.ActivityEditor.Disappearing, this.onActivityEditorDisappearing);
  }

  onActivityEditorAppearing = (args: ActivityEditorAppearingEventArgs) => {
    if (args?.activityDescriptor?.type !== 'SendHttpRequest')
      return;

    this.cleanupListeners();

    let attempts = 0;
    const tryBind = () => {
      const readContent = document.querySelector('#ReadContent') as HTMLInputElement | null;
      const parserList = document.querySelector('#ResponseContentParserName') as HTMLSelectElement | null;

      if (readContent && readContent !== this.readContentEl) {
        if (this.readContentEl) {
          this.readContentEl.removeEventListener('change', this.updateUI);
        }
        readContent.addEventListener('change', this.updateUI);
        this.readContentEl = readContent;
      }

      if (parserList && parserList !== this.parserListEl) {
        if (this.parserListEl) {
          this.parserListEl.removeEventListener('change', this.updateUI);
        }
        parserList.addEventListener('change', this.updateUI);
        this.parserListEl = parserList;
      }

      this.updateUI();

      if ((!readContent || !parserList) && attempts < 15) {
        attempts++;
        this.attachTimer = setTimeout(tryBind, 50);
      }
    };

    tryBind();
  };

  onActivityEditorDisappearing = (args: ActivityEditorDisappearingEventArgs) => {
    if (args?.activityDescriptor?.type !== 'SendHttpRequest')
      return;

    this.cleanupListeners();
  };

  private cleanupListeners = () => {
    if (this.attachTimer) {
      clearTimeout(this.attachTimer);
      this.attachTimer = undefined;
    }
    if (this.readContentEl) {
      this.readContentEl.removeEventListener('change', this.updateUI);
      this.readContentEl = null;
    }
    if (this.parserListEl) {
      this.parserListEl.removeEventListener('change', this.updateUI);
      this.parserListEl = null;
    }
  };

  updateUI = () => {
    const readContentCheckbox = document.querySelector('#ReadContent') as HTMLInputElement | null;
    const parserList = document.querySelector('#ResponseContentParserName') as HTMLSelectElement | null;
    const responseContentParserListControl = document.querySelector('#ResponseContentParserNameControl') as HTMLElement | null;
    const responseContentTargetTypeControl = document.querySelector('#ResponseContentTargetTypeControl') as HTMLElement | null;

    const isReadContent = readContentCheckbox ? Boolean(readContentCheckbox.checked) : false;
    const selectedParserName = parserList ? parserList.value : '';

    if (responseContentParserListControl) {
      responseContentParserListControl.classList.toggle('hidden', !isReadContent);
    }
    if (responseContentTargetTypeControl) {
      responseContentTargetTypeControl.classList.toggle('hidden', (!isReadContent || selectedParserName !== '.NET Type'));
    }
  };
}
