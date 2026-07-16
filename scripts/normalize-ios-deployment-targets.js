#!/usr/bin/env node

const fs = require('node:fs');

const [projectPath, minimum] = process.argv.slice(2);
if (!projectPath || !minimum) {
  console.error(`Usage: ${process.argv[1]} <project.pbxproj> <minimum-version>`);
  process.exit(1);
}

const compareVersions = (left, right) => {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
};

const project = fs.readFileSync(projectPath, 'utf8');
let updated = 0;
const normalized = project.replace(
  /IPHONEOS_DEPLOYMENT_TARGET = ([0-9.]+);/g,
  (line, current) => {
    if (compareVersions(current, minimum) >= 0) return line;
    updated += 1;
    return `IPHONEOS_DEPLOYMENT_TARGET = ${minimum};`;
  }
);

if (updated > 0) fs.writeFileSync(projectPath, normalized);
console.log(`Raised ${updated} CocoaPods deployment target(s) to iOS ${minimum}.`);
