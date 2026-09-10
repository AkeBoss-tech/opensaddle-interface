# Canonical project discovery

Core directory API test passed, including membership filtering, cursor paging, removal between pages and page-size bounds. Twelve Interface directory/device tests passed; renderer and Electron builds passed.

A real Chrome session used disposable Core on loopback 58770 and Vite on 5318. Public APIs created No-checkout-project without a checkout registration or device assignment. It appeared in the workspace rail and personal-device project selector. The selector correctly prevented a proposal until a project source exists. Clicking its project link displayed its own Views navigation, and its Devices link loaded the empty project device view.

Screenshots: out/screenshots/project-directory-20260910/assignment-picker.png and project-navigation.png. Evidence is local fixture behavior, not production authentication or remote task execution. SQLite implements this new directory; backends without the method do not advertise it. Existing legacy registration fallback remains for such servers.
