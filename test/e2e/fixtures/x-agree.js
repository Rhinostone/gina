'use strict';

/**
 * x-agree — a minimal form-associated custom element (FACE) used by the #CC2
 * FormValidator-participation e2e. It is a TEST FIXTURE (not a shipped reference
 * component); it exemplifies the author contract #CC2 documents:
 *
 *   - `static formAssociated = true` + `attachInternals()` → joins form.elements
 *     and the submission payload (via `internals.setFormValue`);
 *   - a `name` attribute (set in the fixture markup) so the validator keys it;
 *   - a `.value` getter the validator reads at harvest / live-check;
 *   - a composed bubbling `change` fired on commit, which rides gina's existing
 *     form-level / reassociated change proxy to drive live validation.
 *
 * Its value is 'yes' when engaged, '' otherwise — so an `isRequired` rule is
 * invalid until the user engages it, giving a clean live-check transition.
 */
(function () {
    if (customElements.get('x-agree')) { return; }

    class XAgree extends HTMLElement {
        static get formAssociated() { return true; }

        constructor() {
            super();
            this._internals = this.attachInternals();
            this._on = false;
        }

        connectedCallback() {
            if (!this._btn) {
                this._btn = document.createElement('button');
                this._btn.type = 'button';
                this._btn.textContent = 'toggle';
                this._btn.setAttribute('aria-pressed', 'false');
                this.appendChild(this._btn);
                this._btn.addEventListener('click', this._toggle.bind(this));
            }
            this._reflect();
        }

        get value() { return this._on ? 'yes' : ''; }
        set value(v) { this._on = (String(v) === 'yes'); this._reflect(); }

        _toggle() {
            this._on = !this._on;
            this._reflect();
            // commit → composed bubbling `change` (the author contract). gina's
            // form-level (or reassociated) change proxy catches this and re-dispatches
            // the element's registered live-check event.
            this.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        }

        _reflect() {
            // participate in form.elements / the submission payload
            this._internals.setFormValue(this.value);
            if (this._btn) { this._btn.setAttribute('aria-pressed', String(this._on)); }
        }
    }

    customElements.define('x-agree', XAgree);
})();
