#!/bin/bash

set -e

./index.js input.csv
json2csv -i medal_count.json -f level,group,age,routine,entriesCount,medals_gold,medals_silver,medals_bronze -o medals_output.csv
json2csv -i output_flat.json -f sectionNumber,level,group,age,routine,names,requests,club -o output.csv
