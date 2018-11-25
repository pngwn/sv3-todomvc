var Todo = (function () {
	'use strict';

	function append(target, node) {
		target.appendChild(node);
	}

	function insert(target, node, anchor) {
		target.insertBefore(node, anchor);
	}

	function detachNode(node) {
		node.parentNode.removeChild(node);
	}

	function destroyEach(iterations, detach) {
		for (var i = 0; i < iterations.length; i += 1) {
			if (iterations[i]) iterations[i].d(detach);
		}
	}

	function createElement(name) {
		return document.createElement(name);
	}

	function createText(data) {
		return document.createTextNode(data);
	}

	function createComment() {
		return document.createComment('');
	}

	function addListener(node, event, handler, options) {
		node.addEventListener(event, handler, options);
	}

	function removeListener(node, event, handler, options) {
		node.removeEventListener(event, handler, options);
	}

	function setAttribute(node, attribute, value) {
		if (value == null) node.removeAttribute(attribute);
		else node.setAttribute(attribute, value);
	}

	function children (element) {
		return Array.from(element.childNodes);
	}

	function setData(text, data) {
		text.data = '' + data;
	}

	function noop() {}

	function run(fn) {
		fn();
	}

	function blankObject() {
		return Object.create(null);
	}

	function run_all(fns) {
		fns.forEach(run);
	}

	function is_function(thing) {
		return typeof thing === 'function';
	}

	function safe_not_equal(a, b) {
		return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
	}

	let update_scheduled = false;

	let dirty_components = [];
	const binding_callbacks = [];
	const render_callbacks = [];

	const intro = { enabled: false };

	function schedule_update(component) {
		dirty_components.push(component);
		if (!update_scheduled) {
			update_scheduled = true;
			queue_microtask(flush);
		}
	}

	function add_render_callback(fn) {
		render_callbacks.push(fn);
	}

	function flush() {
		const seen_callbacks = new Set();

		do {
			// first, call beforeRender functions
			// and update components
			while (dirty_components.length) {
				dirty_components.shift().$$update();
			}

			while (binding_callbacks.length) binding_callbacks.pop()();

			// then, once components are updated, call
			// afterRender functions. This may cause
			// subsequent updates...
			while (render_callbacks.length) {
				const callback = render_callbacks.pop();
				if (!seen_callbacks.has(callback)) {
					callback();

					// ...so guard against infinite loops
					seen_callbacks.add(callback);
				}
			}
		} while (dirty_components.length);

		update_scheduled = false;
	}

	function queue_microtask(callback) {
		Promise.resolve().then(() => {
			if (update_scheduled) callback();
		});
	}

	let current_component;

	function set_current_component(component) {
		current_component = component;
	}

	function onMount(fn) {
		current_component.$$onMount.push(fn);
	}

	function afterRender(fn) {
		current_component.$$afterRender.push(fn);
	}

	class $$Component {
		constructor(options, init, create_fragment, not_equal$$1) {
			this.$$beforeRender = [];
			this.$$onMount = [];
			this.$$afterRender = [];
			this.$$onDestroy = [];

			this.$$bindings = blankObject();
			this.$$callbacks = blankObject();
			this.$$slotted = options.slots || {};

			set_current_component(this);
			const [get_state, inject_props, inject_refs] = init(
				this,
				key => {
					this.$$make_dirty(key);
					if (this.$$bindings[key]) this.$$bindings[key](get_state()[key]);
				}
			);

			this.$$ = { get_state, inject_props, inject_refs, not_equal: not_equal$$1 };

			this.$$refs = {};

			this.$$dirty = null;
			this.$$bindingGroups = []; // TODO find a way to not have this here?

			if (options.props) {
				this.$$.inject_props(options.props);
			}

			run_all(this.$$beforeRender);
			this.$$fragment = create_fragment(this, this.$$.get_state());

			if (options.target) {
				intro.enabled = !!options.intro;
				this.$$mount(options.target, options.anchor, options.hydrate);

				flush();
				intro.enabled = true;
			}
		}

		$destroy() {
			this.$$destroy(true);
			this.$$update = this.$$destroy = noop;
		}

		$on(type, callback) {
			const callbacks = (this.$$callbacks[type] || (this.$$callbacks[type] = []));
			callbacks.push(callback);

			return () => {
				const index = callbacks.indexOf(callback);
				if (index !== -1) callbacks.splice(index, 1);
			};
		}

		$set(values) {
			if (this.$$) {
				const state = this.$$.get_state();
				this.$$.inject_props(values);
				for (const key in values) {
					if (this.$$.not_equal(state[key], values[key])) this.$$make_dirty(key);
				}
			}
		}

		$$bind(name, callback) {
			this.$$bindings[name] = callback;
			callback(this.$$.get_state()[name]);
		}

		$$destroy(detach) {
			if (this.$$) {
				run_all(this.$$onDestroy);
				this.$$fragment.d(detach);

				// TODO null out other refs, including this.$$ (but need to
				// preserve final state?)
				this.$$onDestroy = this.$$fragment = null;
				this.$$.get_state = () => ({});
			}
		}

		$$make_dirty(key) {
			if (!this.$$dirty) {
				schedule_update(this);
				this.$$dirty = {};
			}
			this.$$dirty[key] = true;
		}

		$$mount(target, anchor, hydrate) {
			if (hydrate) {
				this.$$fragment.l(children(target));
				this.$$fragment.m(target, anchor); // TODO can we avoid moving DOM?
			} else {
				this.$$fragment.c();
				this.$$fragment[this.$$fragment.i ? 'i' : 'm'](target, anchor);
			}

			this.$$.inject_refs(this.$$refs);

			// onMount happens after the initial afterRender. Because
			// afterRender callbacks happen in reverse order (inner first)
			// we schedule onMount callbacks before afterRender callbacks
			add_render_callback(() => {
				const onDestroy$$1 = this.$$onMount.map(run).filter(is_function);
				if (this.$$onDestroy) {
					this.$$onDestroy.push(...onDestroy$$1);
				} else {
					// Edge case — component was destroyed immediately,
					// most likely as a result of a binding initialising
					run_all(onDestroy$$1);
				}
				this.$$onMount = [];
			});

			this.$$afterRender.forEach(add_render_callback);
		}

		$$update() {
			run_all(this.$$beforeRender);
			this.$$fragment.p(this.$$dirty, this.$$.get_state());
			this.$$.inject_refs(this.$$refs);
			this.$$dirty = null;

			this.$$afterRender.forEach(add_render_callback);
		}
	}

	/* src/App.html generated by Svelte v2.15.1 */

	function get_each_context(ctx, list, i) {
		const child_ctx = Object.create(ctx);
		child_ctx.item = list[i];
		child_ctx.each_value = list;
		child_ctx.index = i;
		return child_ctx;
	}

	// (6:0) {#if items.length > 0}
	function create_if_block(component, ctx) {
		var section, input, input_checked_value, text0, label, text2, ul0, text3, footer, span, strong, text4_value = ctx.numActive(), text4, text5, text6_value = ctx.numActive() === 1 ? 'item' : 'items', text6, text7, text8, ul1, li0, a0, text9, a0_class_value, text10, li1, a1, text11, a1_class_value, text12, li2, a2, text13, a2_class_value, text14;

		var each_value = ctx.items;

		var each_blocks = [];

		for (var i = 0; i < each_value.length; i += 1) {
			each_blocks[i] = create_each_block(component, get_each_context(ctx, each_value, i));
		}

		var if_block = (ctx.numCompleted()) && create_if_block_1(component, ctx);

		return {
			c() {
				section = createElement("section");
				input = createElement("input");
				text0 = createText("\n\t\t");
				label = createElement("label");
				label.textContent = "Mark all as complete";
				text2 = createText("\n\n\t\t");
				ul0 = createElement("ul");

				for (var i = 0; i < each_blocks.length; i += 1) {
					each_blocks[i].c();
				}

				text3 = createText("\n\n\t\t");
				footer = createElement("footer");
				span = createElement("span");
				strong = createElement("strong");
				text4 = createText(text4_value);
				text5 = createText(" ");
				text6 = createText(text6_value);
				text7 = createText(" left");
				text8 = createText("\n\n\t\t\t");
				ul1 = createElement("ul");
				li0 = createElement("li");
				a0 = createElement("a");
				text9 = createText("All");
				text10 = createText("\n\t\t\t\t");
				li1 = createElement("li");
				a1 = createElement("a");
				text11 = createText("Active");
				text12 = createText("\n\t\t\t\t");
				li2 = createElement("li");
				a2 = createElement("a");
				text13 = createText("Completed");
				text14 = createText("\n\n\t\t\t");
				if (if_block) if_block.c();
				addListener(input, "change", ctx.change_handler);
				input.id = "toggle-all";
				input.className = "toggle-all";
				setAttribute(input, "type", "checkbox");
				input.checked = input_checked_value = ctx.numCompleted() === ctx.items.length;
				label.htmlFor = "toggle-all";
				ul0.className = "todo-list";
				span.className = "todo-count";
				addListener(a0, "click", ctx.click_handler_1);
				a0.className = a0_class_value = ctx.currentFilter === 'all' ? 'selected' : '';
				a0.href = "/";
				addListener(a1, "click", ctx.click_handler_2);
				a1.className = a1_class_value = ctx.currentFilter === 'active' ? 'selected' : '';
				a1.href = "/active";
				addListener(a2, "click", ctx.click_handler_3);
				a2.className = a2_class_value = ctx.currentFilter === 'completed' ? 'selected' : '';
				a2.href = "/completed";
				ul1.className = "filters";
				footer.className = "footer";
				section.className = "main";
			},

			m(target, anchor) {
				insert(target, section, anchor);
				append(section, input);
				append(section, text0);
				append(section, label);
				append(section, text2);
				append(section, ul0);

				for (var i = 0; i < each_blocks.length; i += 1) {
					each_blocks[i].m(ul0, null);
				}

				append(section, text3);
				append(section, footer);
				append(footer, span);
				append(span, strong);
				append(strong, text4);
				append(span, text5);
				append(span, text6);
				append(span, text7);
				append(footer, text8);
				append(footer, ul1);
				append(ul1, li0);
				append(li0, a0);
				append(a0, text9);
				append(ul1, text10);
				append(ul1, li1);
				append(li1, a1);
				append(a1, text11);
				append(ul1, text12);
				append(ul1, li2);
				append(li2, a2);
				append(a2, text13);
				append(footer, text14);
				if (if_block) if_block.m(footer, null);
			},

			p(changed, ctx) {
				if (input_checked_value !== (input_checked_value = ctx.numCompleted() === ctx.items.length)) {
					input.checked = input_checked_value;
				}

				if (changed.filter || changed.items || changed.currentFilter || changed.editing) {
					each_value = ctx.items;

					for (var i = 0; i < each_value.length; i += 1) {
						const child_ctx = get_each_context(ctx, each_value, i);

						if (each_blocks[i]) {
							each_blocks[i].p(changed, child_ctx);
						} else {
							each_blocks[i] = create_each_block(component, child_ctx);
							each_blocks[i].c();
							each_blocks[i].m(ul0, null);
						}
					}

					for (; i < each_blocks.length; i += 1) {
						each_blocks[i].d(1);
					}
					each_blocks.length = each_value.length;
				}

				if (text4_value !== (text4_value = ctx.numActive())) {
					setData(text4, text4_value);
				}

				if (text6_value !== (text6_value = ctx.numActive() === 1 ? 'item' : 'items')) {
					setData(text6, text6_value);
				}

				if ((changed.currentFilter) && a0_class_value !== (a0_class_value = ctx.currentFilter === 'all' ? 'selected' : '')) {
					a0.className = a0_class_value;
				}

				if ((changed.currentFilter) && a1_class_value !== (a1_class_value = ctx.currentFilter === 'active' ? 'selected' : '')) {
					a1.className = a1_class_value;
				}

				if ((changed.currentFilter) && a2_class_value !== (a2_class_value = ctx.currentFilter === 'completed' ? 'selected' : '')) {
					a2.className = a2_class_value;
				}

				if (ctx.numCompleted()) {
					if (!if_block) {
						if_block = create_if_block_1(component, ctx);
						if_block.c();
						if_block.m(footer, null);
					}
				} else if (if_block) {
					if_block.d(1);
					if_block = null;
				}
			},

			d(detach) {
				if (detach) {
					detachNode(section);
				}

				removeListener(input, "change", ctx.change_handler);

				destroyEach(each_blocks, detach);

				removeListener(a0, "click", ctx.click_handler_1);
				removeListener(a1, "click", ctx.click_handler_2);
				removeListener(a2, "click", ctx.click_handler_3);
				if (if_block) if_block.d();
			}
		};
	}

	// (13:4) {#if filter(item, currentFilter)}
	function create_if_block_2(component, ctx) {
		var li, div, input, text0, label, text1_value = ctx.item.description, text1, text2, button, text3, li_class_value;

		function input_change_handler() {
			ctx.input_change_handler.call(this, ctx);
		}

		function dblclick_handler() {
			return ctx.dblclick_handler(ctx);
		}

		function click_handler() {
			return ctx.click_handler(ctx);
		}

		var if_block = (ctx.editing === ctx.index) && create_if_block_3(component, ctx);

		return {
			c() {
				li = createElement("li");
				div = createElement("div");
				input = createElement("input");
				text0 = createText("\n\t\t\t\t\t\t\t");
				label = createElement("label");
				text1 = createText(text1_value);
				text2 = createText("\n\t\t\t\t\t\t\t");
				button = createElement("button");
				text3 = createText("\n\n\t\t\t\t\t\t");
				if (if_block) if_block.c();
				addListener(input, "change", input_change_handler);
				input.className = "toggle";
				setAttribute(input, "type", "checkbox");
				addListener(label, "dblclick", dblclick_handler);
				addListener(button, "click", click_handler);
				button.className = "destroy";
				div.className = "view";
				li.className = li_class_value = "" + (ctx.item.completed ? 'completed' : '') + " " + (ctx.editing === ctx.index ? 'editing' : '');
			},

			m(target, anchor) {
				insert(target, li, anchor);
				append(li, div);
				append(div, input);

				input.checked = ctx.item.completed;

				append(div, text0);
				append(div, label);
				append(label, text1);
				append(div, text2);
				append(div, button);
				append(li, text3);
				if (if_block) if_block.m(li, null);
			},

			p(changed, new_ctx) {
				ctx = new_ctx;
				if (changed.items) input.checked = ctx.item.completed;
				if ((changed.items) && text1_value !== (text1_value = ctx.item.description)) {
					setData(text1, text1_value);
				}

				if (ctx.editing === ctx.index) {
					if (if_block) {
						if_block.p(changed, ctx);
					} else {
						if_block = create_if_block_3(component, ctx);
						if_block.c();
						if_block.m(li, null);
					}
				} else if (if_block) {
					if_block.d(1);
					if_block = null;
				}

				if ((changed.items || changed.editing) && li_class_value !== (li_class_value = "" + (ctx.item.completed ? 'completed' : '') + " " + (ctx.editing === ctx.index ? 'editing' : ''))) {
					li.className = li_class_value;
				}
			},

			d(detach) {
				if (detach) {
					detachNode(li);
				}

				removeListener(input, "change", input_change_handler);
				removeListener(label, "dblclick", dblclick_handler);
				removeListener(button, "click", click_handler);
				if (if_block) if_block.d();
			}
		};
	}

	// (21:6) {#if editing === index}
	function create_if_block_3(component, ctx) {
		var input, input_value_value;

		return {
			c() {
				input = createElement("input");
				addListener(input, "keydown", ctx.keydown_handler_1);
				addListener(input, "blur", ctx.blur_handler);
				input.value = input_value_value = ctx.item.description;
				input.id = "edit";
				input.className = "edit";
				input.autofocus = true;
			},

			m(target, anchor) {
				insert(target, input, anchor);
				input.focus();
			},

			p(changed, ctx) {
				if ((changed.items) && input_value_value !== (input_value_value = ctx.item.description)) {
					input.value = input_value_value;
				}
			},

			d(detach) {
				if (detach) {
					detachNode(input);
				}

				removeListener(input, "keydown", ctx.keydown_handler_1);
				removeListener(input, "blur", ctx.blur_handler);
			}
		};
	}

	// (12:3) {#each items as item, index}
	function create_each_block(component, ctx) {
		var if_block_anchor;

		var if_block = (ctx.filter(ctx.item, ctx.currentFilter)) && create_if_block_2(component, ctx);

		return {
			c() {
				if (if_block) if_block.c();
				if_block_anchor = createComment();
			},

			m(target, anchor) {
				if (if_block) if_block.m(target, anchor);
				insert(target, if_block_anchor, anchor);
			},

			p(changed, ctx) {
				if (ctx.filter(ctx.item, ctx.currentFilter)) {
					if (if_block) {
						if_block.p(changed, ctx);
					} else {
						if_block = create_if_block_2(component, ctx);
						if_block.c();
						if_block.m(if_block_anchor.parentNode, if_block_anchor);
					}
				} else if (if_block) {
					if_block.d(1);
					if_block = null;
				}
			},

			d(detach) {
				if (if_block) if_block.d(detach);
				if (detach) {
					detachNode(if_block_anchor);
				}
			}
		};
	}

	// (40:3) {#if numCompleted()}
	function create_if_block_1(component, ctx) {
		var button;

		return {
			c() {
				button = createElement("button");
				button.textContent = "Clear completed";
				addListener(button, "click", ctx.click_handler_4);
				button.className = "clear-completed";
			},

			m(target, anchor) {
				insert(target, button, anchor);
			},

			d(detach) {
				if (detach) {
					detachNode(button);
				}

				removeListener(button, "click", ctx.click_handler_4);
			}
		};
	}

	function $$create_fragment(component, ctx) {
		var header, h1, text1, input, text2, if_block_anchor, current;

		var if_block = (ctx.items.length > 0) && create_if_block(component, ctx);

		return {
			c() {
				header = createElement("header");
				h1 = createElement("h1");
				h1.textContent = "todos";
				text1 = createText("\n\t");
				input = createElement("input");
				text2 = createText("\n\n");
				if (if_block) if_block.c();
				if_block_anchor = createComment();
				addListener(input, "keydown", ctx.keydown_handler);
				input.className = "new-todo";
				input.placeholder = "What needs to be done?";
				input.autofocus = true;
				header.className = "header";
			},

			m(target, anchor) {
				insert(target, header, anchor);
				append(header, h1);
				append(header, text1);
				append(header, input);
				component.$$refs.todoRef = input;
				insert(target, text2, anchor);
				if (if_block) if_block.m(target, anchor);
				insert(target, if_block_anchor, anchor);
				current = true;
				input.focus();
			},

			p(changed, ctx) {
				if (ctx.items.length > 0) {
					if (if_block) {
						if_block.p(changed, ctx);
					} else {
						if_block = create_if_block(component, ctx);
						if_block.c();
						if_block.m(if_block_anchor.parentNode, if_block_anchor);
					}
				} else if (if_block) {
					if_block.d(1);
					if_block = null;
				}
			},

			i(target, anchor) {
				if (current) return;

				this.m(target, anchor);
			},

			o: run,

			d(detach) {
				if (detach) {
					detachNode(header);
				}

				removeListener(input, "keydown", ctx.keydown_handler);
				if (component.$$refs.todoRef === input) {
								component.$$refs.todoRef = null;
								component.$$.inject_refs(component.$$refs);
							}
				if (detach) {
					detachNode(text2);
				}

				if (if_block) if_block.d(detach);
				if (detach) {
					detachNode(if_block_anchor);
				}
			}
		};
	}

	function $$init($$self, $$make_dirty) {

		let items = [];
		let currentFilter = 'all';
		let editing, todoRef; 

		try {
			items = JSON.parse(localStorage.getItem('todos-svelte')) || []; $$make_dirty('items');
		} catch (err) {
			items = []; $$make_dirty('items');
		}
		
		// computed	
		const numActive = () => items.filter(item => !item.completed).length;
		const numCompleted = () => items.filter(item => item.completed).length;
			
		// helper
		const filter = (item, currentFilter) => {
			if (currentFilter === 'all') return true;
			if (currentFilter === 'completed') return item.completed;
			if (currentFilter === 'active') return !item.completed;
		};
		
		// lifecycle
		onMount(() => {
			const updateView = () => {
				currentFilter = 'all'; $$make_dirty('currentFilter');
				if (window.location.hash === '#/active') {
					currentFilter = 'active'; $$make_dirty('currentFilter');
				} else if (window.location.hash === '#/completed') {
					currentFilter = 'completed'; $$make_dirty('currentFilter');
				}
			};
			window.addEventListener('hashchange', updateView);
			updateView();
		});

		afterRender(() => {
			try {
				localStorage.setItem('todos-svelte', JSON.stringify(items));
			} catch (err) {
				// noop
			}
		});
		
		// methods
		const blurNode = node => node.blur();
		
		const cancel = () => { const $$result = editing = null; $$make_dirty('editing'); return $$result; };

		const clearCompleted = () => { const $$result = items = items.filter(item => !item.completed); $$make_dirty('items'); return $$result; };
		
		const edit = (index) => { const $$result = editing = index; $$make_dirty('editing'); return $$result; };
			
		const newTodo = description => {
			items = [...items, {
				description,
				completed: false
			}]; $$make_dirty('items');
			todoRef.value = ''; $$make_dirty('todoRef');
		};

		const remove = index => { const $$result = items = items.splice(index, 1); $$make_dirty('items'); return $$result; };
			
		const submit = description => 
			{ const $$result = items = items.map((v, i) => i === editing ? {...v, description } : v); $$make_dirty('items'); return $$result; }; 
			
		const toggleAll = checked => { const $$result = items = items.map(v => ({...v, completed: checked})); $$make_dirty('items'); return $$result; };
		
		const handleKeycode = (node, key) => {
			if (key === "Enter") {
				blurNode(node);
				cancel();
			}		if (key === "Escape") cancel();
		};

		const updateHash = (e, val) => {
			e.preventDefault();
			window.location.hash = val;
		};

		function keydown_handler({key}) {
			return key === "Enter" ? newTodo(this.value): null;
		}

		function change_handler() {
			return toggleAll(this.checked);
		}

		function dblclick_handler({ index }) {
			return edit(index);
		}

		function click_handler({ index }) {
			return remove(index);
		}

		function keydown_handler_1({key}) {
			return handleKeycode(this, key);
		}

		function blur_handler(e) {
			return submit(this.value);
		}

		function click_handler_1(e) {
			return updateHash(e, "#/");
		}

		function click_handler_2(e) {
			return updateHash(e, "#/active");
		}

		function click_handler_3(e) {
			return updateHash(e, "#/completed");
		}

		function click_handler_4() {
			return clearCompleted();
		}

		function input_change_handler({ item, each_value, index }) {
			each_value[index].completed = this.checked;
			$$make_dirty('items');
		}

		return [
			// TODO only what's needed by the template
			() => ({ items, currentFilter, editing, todoRef, numActive, numCompleted, filter, blurNode, cancel, clearCompleted, edit, newTodo, remove, submit, toggleAll, handleKeycode, updateHash, onMount, afterRender, keydown_handler, change_handler, dblclick_handler, click_handler, keydown_handler_1, blur_handler, click_handler_1, click_handler_2, click_handler_3, click_handler_4, input_change_handler }),
			noop,
			$$refs => {
				todoRef = $$refs.todoRef;
			}
		];
	}

	class App extends $$Component {
		constructor(options) {
			super(options, $$init, $$create_fragment, safe_not_equal);
		}


	}

	const app = new App({
	  target: document.querySelector(".todoapp"),
	  name: "Todo"
	});

	return app;

}());
//# sourceMappingURL=bundle.js.map
