#!/bin/bash
export RC_ROOT=C:/Users/bitse/AppData/Local/Temp/claude/C--Users-bitse-Desktop-projects-ghost-on-door/1c342518-5275-477e-b2c1-ec5cfa2a0782/scratchpad/zip2
export RC_SHOTS2=C:/Users/bitse/AppData/Local/Temp/claude/C--Users-bitse-Desktop-projects-ghost-on-door/1c342518-5275-477e-b2c1-ec5cfa2a0782/scratchpad/shots7b/
cd "$(dirname "$0")"
for t in t2 t1c t3 t4 t5a t5b t5c t6 t10 t11 t12 t13 t14 t8 t7; do
  echo "##### $t" > out-$t.log
  node $t.mjs >> out-$t.log 2>&1
  echo "exit $?" >> out-$t.log
done
echo ALLDONE > alldone.flag
