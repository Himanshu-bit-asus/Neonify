# Bugfix Requirements Document

## Introduction

The Neonify/Streamify PWA currently fails to load icon files, resulting in 404 errors when the browser attempts to fetch PWA icons. The manifest.json file references `/icon` with size 192x192 as a PNG, but the server looks for `/icon-192.png` which doesn't exist. Next.js has an icon.tsx file that dynamically generates icons, but the manifest.json configuration doesn't align with Next.js's icon routing conventions. This bug prevents proper PWA installation and causes console errors during runtime.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the browser/PWA loads the manifest.json and attempts to fetch the icon at `/icon` with type `image/png` and size `192x192` THEN the server returns a 404 error for `/icon-192.png`

1.2 WHEN the PWA installation process needs icon files for different device contexts THEN the system fails to provide properly sized PNG icon variants (192x192, 512x512, etc.)

1.3 WHEN the manifest.json references `/icon` as a PNG type THEN the path doesn't match Next.js's dynamic icon route which serves from `/icon` without size suffix

### Expected Behavior (Correct)

2.1 WHEN the browser/PWA loads the manifest.json and attempts to fetch icon files THEN the system SHALL serve valid icon files without 404 errors

2.2 WHEN the PWA installation process needs icon files for different device contexts THEN the system SHALL provide properly sized icon files matching the manifest.json configuration

2.3 WHEN the manifest.json references icon paths THEN the paths SHALL correctly align with Next.js's icon routing system (using `/icon` for the icon.tsx generated image)

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the browser/PWA requests the SVG icon at `/icon.svg` THEN the system SHALL CONTINUE TO serve the existing icon.svg file correctly

3.2 WHEN the application runs in non-PWA mode THEN the system SHALL CONTINUE TO function normally with all existing features

3.3 WHEN the manifest.json is loaded for other PWA properties (name, start_url, display, colors) THEN the system SHALL CONTINUE TO use those values correctly
