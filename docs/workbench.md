**M5–M7 interactive workbench**

The main application is now a working neuroevolution workbench. Run `npm run dev` and open the local URL. The separate `runtime.html` diagnostic page remains available from the header.

Choose an open or obstacle arena, a seed, population, food count, and episode duration. Advanced settings expose trial count, elites, immigrants, mutation probability, and mutation magnitude. The draft map is the actual first training scenario at generation zero. Invalid drafts show an error and cannot start. Configuration changes apply when starting a new experiment; they do not modify an active run. Pause training before replacing an experiment.

Create the experiment to inspect its first randomly initialized neural controller. The selected trial opens paused after the first decision. Train a chosen number of additional generations or pause an active batch. Progress reports completed generations and active trial count. Every genome has a private world with the generation's shared trial conditions. Training and playback have separate pause controls.

The arena draws one selected independent trial. Choose a genome from the current population or a historical champion. Play, pause, change playback speed, step one physics tick, step through the next decision, or seek to a tick. Space toggles playback and right arrow steps a decision when focus is outside an interactive control. Clicking the agent or the Inspect agent button focuses the inspector. Canvas hit testing uses the same letterboxed world transform as drawing, so resizing does not stretch the world or displace the selectable body.

World view shows food, obstacles, the selected body, optional sensors, and a recent sampled trail. Sensors are drawn at the recorded decision pose, which can differ from the current body pose. Sensor-only view shows the eight sector readings and eight obstacle rays in body-relative coordinates; it hides exact food positions, walls, the global pose, and the trail. It is a visualization of the observation vector, not an additional source of controller information.

The inspector distinguishes the decision tick from the current body tick:

| View | Information |
| --- | --- |
| Brain | Fixed 20–12–2 graph; actual hidden activity and motor outputs; all 264 inherited connections; neuron focus and weight-magnitude filtering; numerical activation, connection, and bias tables |
| Sensors | Eight food and eight obstacle proximity readings; energy, signed speed, angular velocity, and contact input; all 20 numeric inputs and held motor commands |
| Measures | Current food, energy, distance, contact time, survival, and velocities; recorded trial food when available; replay result and original evaluation identity |

Weights are distinguished by signed numeric values and dashed/solid lines as well as color. Neurons are keyboard selectable. Inspector tabs support arrow/Home/End navigation. Motor meters show signed commands. Display numbers are rounded for readability; tooltips and data bindings retain the source values. Activity is presented without assigning untested functional names to neurons. Selecting a neuron and adjusting the weight filter persists across inspector tabs.

The progress chart separates training best, training median, and fixed-validation scores. Training maps rotate each generation. Every ten completed generations, the training-selected champion is evaluated on 16 fixed validation scenarios without influencing reproduction. The chart shows the latest 100 generations, and a measurement table supplies the numeric data. Select a champion to replay its evaluated weights on one of its original training trials; new maps are not substituted.

The main workbench now saves completed populations, retained history, and a checkpoint bookmark in IndexedDB before acknowledging each generation. Reload recovers the active save paused; partial active generations rerun. UI retention remains up to 1,000 summaries and 50 recent champion replays plus the inspected champion. Use the saved-experiment selector to switch experiments and `.evolab` export/import for independent backups. See [M6 persistence and recovery](persistence.md) for atomic saves, pending-save export, conflicts, and archive limits.

The Sensor intervention panel forks the paused selected trial at its next decision. It shows control/masked trajectories, numeric outcome differences, raw/effective inputs, and motor outputs. Saved comparisons remain independent of the selected playback and training, and can be rerun after reload or portable import. See [the intervention guide](interventions.md).

Implementation uses one cached immutable UI snapshot for `useSyncExternalStore`. Coarse worker status drives controls and history. Canvas frames arrive outside React and draw on the next animation frame; static geometry is cached. Inspector publication is limited to approximately 10 Hz while running, with immediate exact state for paused commands. The graph's static connection layer is memoized, and no population-wide position or activation buffers enter React state. Viewer preferences and neuron filtering do not send result-affecting experiment commands.

On narrow screens, settings collapse and Inspector/History switch through tabs. Controls retain visible focus states, readable non-color indicators, and reduced-motion handling. The implementation uses local fonts and assets and loads correctly under a repository base path.

Verification on pinned Chromium against the production build under `/evo/`:

- 35 engine/runtime/store tests pass, including network parameter mapping, stable store snapshots, original-scenario champion replay, pinned replay retention, and immediate final playback status.
- 12 browser tests pass across M4 and M5. Workbench coverage includes create/train/history selection, exact agreement of all 20 input readings and hidden activity with a reference decision, filtering and keyboard selection, deterministic results during presentation changes, invalid-draft recovery, mobile layout without horizontal overflow, keyboard playback, fixed validation, and rewinding completed episodes.
- Axe reports no automated WCAG A/AA violations across Brain, Sensors, and Measures at 1280 px and 390 px widths. This is automated evidence, not a complete accessibility conformance audit.
- Typecheck, lint, and the production build pass. Desktop and mobile screenshots were visually inspected. Broader browser/device acceptance and scientific benchmarks remain release work.
