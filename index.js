#!/usr/bin/env node

const csvToJson = require('convert-csv-to-json');
const json2csv = require('json2csv').parse;
const sortBy = require('sort-by');
const flatmap = require('flatmap');
const fs = require('fs');

const validLevels = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14'];


let inputFile = process.argv[2];
console.log('inputFile:', inputFile);

const json = csvToJson.fieldDelimiter(',').getJsonFromCsv(inputFile);

function convertToLevel(_level) {
    if (_level.toUpperCase().indexOf('STAGE') !== -1) {
        return 'STAGE ' + _level.replace(/^\D+/g, '');
    } else if (validLevels.includes(_level)) {
        return parseInt(_level);
    } else switch (_level) {
        case '9-16':
            return 9;
        case '11-16':
            return 10;
        case '12-18':
            return 11;
        case '13-19':
            return 12;
    }
    let numericLevelText = _level.replace(/^\D/g, '');
    console.log('numericLevelText', numericLevelText);
    if (validLevels.includes(numericLevelText)) {
        return parseInt(numericLevelText);
    }
}

function convertToGroup(_group) {
    return _group.replace('X', '').replace('P', '2');
}

function convertToPreferredTime(_request) {
    if (_request.indexOf("AFTER") !== -1) {
        return "7";
    } else if (_request.indexOf("1ST") !== -1) {
        return "1";
    } else if (_request.indexOf("2ND") !== -1) {
        return "2";
    } else if (_request.indexOf("MORNING") !== -1) {
        return "2";
    }
    return _request;
}


function getMostLikelyAgeGroup(dirtyEntry) {
    return dirtyEntry.AGE.toUpperCase().indexOf('S') !== -1 ? 'SNR' : 'JNR';
}

function placeUatEnd(age) {
    if (age.indexOf('U') === 0) {
        return age.substring(1) + 'U';
    } else {
        return age;
    }
}

let entries = json.map(dirtyEntry => {
    let names = (dirtyEntry['NAMEANDSURNAMEOFGROUP/PAIR'] || dirtyEntry.Gymnastsnames || dirtyEntry.names)
        .trim()
        .replace(' and ', '&')
        .replace(/"/g, '');

    let individualNames = names.split('&').map(name => name.replace('"', '').trim());
    return {
        level: convertToLevel(dirtyEntry.LEVEL),
        age: placeUatEnd((dirtyEntry.AGE.match(/(\d|U|\+|-)/g) || [getMostLikelyAgeGroup(dirtyEntry)]).join('')),
        group: convertToGroup(dirtyEntry.GROUP),
        routine: dirtyEntry['COMB/BAL/DYN'],
        requests: dirtyEntry.Requests.trim(),
        preferredTime: convertToPreferredTime(dirtyEntry.Requests.trim().toUpperCase()),
        names: individualNames.join(' & '),
        individualNames: individualNames,
        club: dirtyEntry.Club.trim(),
    };
});


function isEntryValid(entry) {
    if (validLevels.includes(entry.level.toString())) {
        return true;
    } else if (entry.level.indexOf("STAGE ") === 0) {
        return true;
    }
    return false;
}

let invalidEntries = entries.filter(entry => !isEntryValid(entry));
if (invalidEntries.length !== 0) {
    console.log('Invalid entries:', invalidEntries);
    return;
}


entries = entries.sort(sortBy('level', 'group', 'age'));

function removeElementFromArray(arr, item) {
    for (let i = arr.length; i--;) {
        if (arr[i] === item) {
            arr.splice(i, 1);
        }
    }
}

function createSectionGroupKey(entry) {
    return JSON.stringify({
        level: entry.level,
        age: entry.age,
        group: entry.group,
        routine: entry.routine,
    });
}

const groupKeys = [...new Set(entries.map(entry => {
    return createSectionGroupKey(entry);
}))].map(jsonObject => JSON.parse(jsonObject))
    .sort(sortBy('level', 'group', 'age', 'routine'));


let gyoups = groupKeys.map(groupKey => {
    let entriesForGroup = entries.filter(entry => {
        return entry.level === groupKey.level
            && entry.age === groupKey.age
            && entry.group === groupKey.group
            && entry.routine === groupKey.routine;
    });

    let preferredTime = [...new Set(entriesForGroup.map(entry => entry.preferredTime).filter(preferredTime => preferredTime !== ''))][0] || '5';
    // console.log(groupKey, entriesForGroup.length, preferredTime);

    groupKey['time'] = preferredTime;
    groupKey['entriesForGroup'] = entriesForGroup;
    groupKey['individualNames'] = flatmap(entriesForGroup, entry => entry.individualNames);
    return groupKey;
});


gyoups.sort(sortBy('level', 'group', 'age', 'routine'));
let gyoupsWithMedals = gyoups.map(g => {
    let groupMedalMultiplier = getGroupMedalMultiplier(g.group);
    let entriesCount = g.entriesForGroup.length;


    function getGroupMedalMultiplier(group) {
        for (var level = 1; level <= 4; level++) {
            if (group.indexOf(level.toString()) !== -1) {
                return level;
            }
        }

        return 1;
    }

    function getNumberOfMedalsForEntries(entriesCount, number) {
        return (entriesCount >= number ? 1 : 0);
    }

    return {
        level: g.level,
        age: g.age,
        group: g.group,
        routine: g.routine,
        time: g.time,
        entriesCount: entriesCount,
        medals_gold: groupMedalMultiplier * getNumberOfMedalsForEntries(entriesCount, 1),
        medals_silver: groupMedalMultiplier * getNumberOfMedalsForEntries(entriesCount, 2),
        medals_bronze: groupMedalMultiplier * getNumberOfMedalsForEntries(entriesCount, 3),
    };
});
console.log(gyoupsWithMedals);
fs.writeFileSync('medal_count.json', JSON.stringify(gyoupsWithMedals, null, 4), 'utf8');

console.log('Total entries:', entries.length);


gyoups.sort(sortBy('time', 'level', 'group', 'age', 'routine'));


function createSection(sectionNumber) {
    let sectionEntries = [];

    while (sectionEntries.length < 10 && gyoups.length > 0) {
        let gyoup = gyoups.filter(gyoup => {
            let names = gyoup.individualNames.filter(name => {
                let newVar = flatmap(sectionEntries, sectionEntry => sectionEntry.individualNames);
                return newVar.includes(name);
            });
            return names.length === 0;
        })[0];

        if (!gyoup) {
            break;
        }
        removeElementFromArray(gyoups, gyoup);
        sectionEntries.push(...gyoup.entriesForGroup);
    }


    return {
        sectionNumber: sectionNumber,
        entries: sectionEntries,
        numberOfEntries: sectionEntries.length
    };
}

let sections = [];
let numberOfSections = 0;

while (gyoups.length > 0) {
    sections.push(createSection(++numberOfSections));
}

let sectionsJSON = JSON.stringify(sections, null, 4);
// console.log("Sections:", sectionsJSON);
fs.writeFileSync('output.json', sectionsJSON, 'utf8');
fs.writeFileSync('output_flat.json', JSON.stringify(flatmap(sections.map(section => {
    return section.entries.map(entry => {
        entry.sectionNumber = section.sectionNumber;
        return entry;
    });
}), e => e), null, 4), 'utf8');


// const fields = ['level', 'age', 'group', 'routine', 'names', 'requests', 'club'];
// const opts = {fields};
//
// try {
//     sections.forEach(section => {
//         const csv = json2csv(section.entries.map(entry => {
//             entry.names = entry.individualNames.join('&');
//             return entry;
//         }), opts);
//         console.log(csv);
//     });
// } catch (err) {
//     console.error(err);
// }
