(function (global) {
  var Db = global.BadmintonDb;

  // ---- Players (port of PlayerService.java) ----

  function normalizeName(rawName) {
    var trimmed = (rawName || '').trim().replace(/\s+/g, ' ');
    var result = '';
    var startOfWord = true;
    for (var i = 0; i < trimmed.length; i++) {
      var c = trimmed.charAt(i);
      if (c === ' ') {
        result += c;
        startOfWord = true;
      } else if (startOfWord) {
        result += c.toUpperCase();
        startOfWord = false;
      } else {
        result += c.toLowerCase();
      }
    }
    return result;
  }

  var Players = {
    normalize: normalizeName,

    findAll: function () {
      return Db.getAll('players').then(function (list) {
        list.sort(function (a, b) {
          return a.name.localeCompare(b.name);
        });
        return list;
      });
    },

    findOrCreate: function (rawName) {
      var name = normalizeName(rawName);
      var nameLower = name.toLowerCase();
      return Db.getAllByIndex('players', 'nameLower', nameLower).then(function (matches) {
        if (matches.length > 0) {
          return matches[0];
        }
        var player = { name: name, nameLower: nameLower };
        return Db.add('players', player).then(function (id) {
          player.id = id;
          return player;
        });
      });
    },

    /** Set of player ids that appear in at least one game (any day, decided or not, deleted or not). */
    idsWithGames: function () {
      return Db.getAll('games').then(function (games) {
        var ids = {};
        games.forEach(function (g) {
          ids[g.team1Player1Id] = true;
          ids[g.team1Player2Id] = true;
          ids[g.team2Player1Id] = true;
          ids[g.team2Player2Id] = true;
        });
        return ids;
      });
    },

    hasPlayedAnyGame: function (playerId) {
      return Db.getAll('games').then(function (games) {
        return games.some(function (g) {
          return g.team1Player1Id === playerId || g.team1Player2Id === playerId
            || g.team2Player1Id === playerId || g.team2Player2Id === playerId;
        });
      });
    },

    /** Deletes a player. Refuses (and leaves the player untouched) if they've ever played a game. */
    remove: function (playerId) {
      return Players.hasPlayedAnyGame(playerId).then(function (hasGames) {
        if (hasGames) {
          throw new Error('This player has already played a game and cannot be deleted');
        }
        return Db.remove('players', playerId);
      });
    },

    /** Renames a player in place; every game they've played keeps referencing the same player id. */
    rename: function (playerId, rawNewName) {
      var newName = normalizeName(rawNewName);
      var newNameLower = newName.toLowerCase();
      return Db.get('players', playerId).then(function (player) {
        if (!player) {
          throw new Error('Player not found: ' + playerId);
        }
        if (player.nameLower === newNameLower) {
          player.name = newName;
          return Db.put('players', player).then(function () {
            return player;
          });
        }
        return Db.getAllByIndex('players', 'nameLower', newNameLower).then(function (matches) {
          if (matches.length > 0) {
            throw new Error('Another player already has this name');
          }
          player.name = newName;
          player.nameLower = newNameLower;
          return Db.put('players', player).then(function () {
            return player;
          });
        });
      });
    }
  };

  // ---- Game days (port of GameDayService.java) ----

  var MAX_RETAINED_DAYS = 10;
  // Indexed by Date#getDay(), which starts the week on Sunday.
  var DAY_NAMES = ['Chủ Nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  // e.g. "Thứ 5, 24/9/2026"
  function formatDefaultDayName(date) {
    return DAY_NAMES[date.getDay()] + ', ' + date.getDate() + '/' + (date.getMonth() + 1) + '/' + date.getFullYear();
  }

  function pruneOldDays() {
    return Db.getAll('gameDays').then(function (all) {
      all.sort(function (a, b) {
        return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
      });
      var excess = all.length - MAX_RETAINED_DAYS;
      if (excess <= 0) {
        return;
      }
      var oldest = all.slice(0, excess);
      return Promise.all(oldest.map(function (day) {
        return Db.getAllByIndex('games', 'gameDayId', day.id).then(function (games) {
          return Promise.all(games.map(function (g) {
            return Db.remove('games', g.id);
          }));
        }).then(function () {
          return Db.remove('gameDays', day.id);
        });
      }));
    });
  }

  var GameDays = {
    MAX_RETAINED_DAYS: MAX_RETAINED_DAYS,

    findLatest: function (count) {
      return Db.getAll('gameDays').then(function (all) {
        all.sort(function (a, b) {
          return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
        });
        return all.slice(0, count);
      });
    },

    createForToday: function () {
      var now = new Date();
      var day = {
        date: now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate()),
        name: formatDefaultDayName(now),
        createdAt: now.toISOString()
      };
      return Db.add('gameDays', day).then(function (id) {
        day.id = id;
        return pruneOldDays().then(function () {
          return day;
        });
      });
    },

    getOrThrow: function (id) {
      return Db.get('gameDays', id).then(function (day) {
        if (!day) {
          throw new Error('Day not found: ' + id);
        }
        return day;
      });
    },

    rename: function (day, newName) {
      var trimmed = (newName || '').trim();
      if (!trimmed) {
        return Promise.resolve(day);
      }
      day.name = trimmed;
      return Db.put('gameDays', day).then(function () {
        return day;
      });
    },

    /**
     * Remembers what was typed into the End Day price boxes for this day, as raw input
     * strings ({ shuttlecock, court, water }) so an empty box stays empty rather than "0".
     * Re-reads the day first so a concurrent rename isn't overwritten.
     */
    savePrices: function (dayId, prices) {
      return GameDays.getOrThrow(dayId).then(function (day) {
        day.prices = {
          shuttlecock: prices.shuttlecock || '',
          court: prices.court || '',
          water: prices.water || ''
        };
        return Db.put('gameDays', day);
      });
    },

    /** Permanently deletes a day and every game recorded on it. Players are untouched. */
    remove: function (dayId) {
      return Db.getAllByIndex('games', 'gameDayId', dayId).then(function (games) {
        return Promise.all(games.map(function (g) {
          return Db.remove('games', g.id);
        }));
      }).then(function () {
        return Db.remove('gameDays', dayId);
      });
    }
  };

  // ---- Games (port of GameService.java) ----

  var Games = {
    findAllForDay: function (gameDayId) {
      return Db.getAllByIndex('games', 'gameDayId', gameDayId).then(function (games) {
        var active = games.filter(function (g) {
          return !g.deletedAt;
        });
        active.sort(function (a, b) {
          return b.id - a.id;
        });
        return active;
      });
    },

    addGame: function (gameDayId, team1Player1Name, team1Player2Name, team2Player1Name, team2Player2Name) {
      var names = [team1Player1Name, team1Player2Name, team2Player1Name, team2Player2Name].map(normalizeName);
      var distinct = {};
      names.forEach(function (n) {
        distinct[n.toLowerCase()] = true;
      });
      if (Object.keys(distinct).length < 4) {
        return Promise.reject(new Error('Each player can only appear once in a game'));
      }
      return Promise.all(names.map(Players.findOrCreate)).then(function (players) {
        var game = {
          gameDayId: gameDayId,
          team1Player1Id: players[0].id,
          team1Player2Id: players[1].id,
          team2Player1Id: players[2].id,
          team2Player2Id: players[3].id,
          winningTeam: null,
          createdAt: new Date().toISOString(),
          deletedAt: null
        };
        return Db.add('games', game).then(function (id) {
          game.id = id;
          return game;
        });
      });
    },

    getOrThrow: function (id) {
      return Db.get('games', id).then(function (g) {
        if (!g) {
          throw new Error('Game not found: ' + id);
        }
        return g;
      });
    },

    setWinner: function (game, winningTeam) {
      game.winningTeam = winningTeam;
      return Db.put('games', game).then(function () {
        return game;
      });
    },

    duplicate: function (game) {
      var copy = {
        gameDayId: game.gameDayId,
        team1Player1Id: game.team1Player1Id,
        team1Player2Id: game.team1Player2Id,
        team2Player1Id: game.team2Player1Id,
        team2Player2Id: game.team2Player2Id,
        winningTeam: null,
        createdAt: new Date().toISOString(),
        deletedAt: null
      };
      return Db.add('games', copy).then(function (id) {
        copy.id = id;
        return copy;
      });
    },

    delete: function (game) {
      game.deletedAt = new Date().toISOString();
      return Db.put('games', game).then(function () {
        return game;
      });
    },

    hasDeletedGames: function (gameDayId) {
      return Db.getAllByIndex('games', 'gameDayId', gameDayId).then(function (games) {
        return games.some(function (g) {
          return !!g.deletedAt;
        });
      });
    },

    undoLastDelete: function (gameDayId) {
      return Db.getAllByIndex('games', 'gameDayId', gameDayId).then(function (games) {
        var deleted = games.filter(function (g) {
          return !!g.deletedAt;
        });
        if (deleted.length === 0) {
          throw new Error('No deleted game to restore');
        }
        deleted.sort(function (a, b) {
          return a.deletedAt < b.deletedAt ? 1 : a.deletedAt > b.deletedAt ? -1 : 0;
        });
        var game = deleted[0];
        game.deletedAt = null;
        return Db.put('games', game).then(function () {
          return game;
        });
      });
    }
  };

  // ---- Settlement (port of SettlementService.java) ----

  var Settlement = {
    settle: function (gameDayId, shuttlecockPrice, courtPrice, waterPrice) {
      return Games.findAllForDay(gameDayId).then(function (games) {
        if (games.length === 0) {
          throw new Error('No games recorded for this day yet');
        }
        var decidedGames = games.filter(function (g) {
          return g.winningTeam !== null && g.winningTeam !== undefined;
        });
        if (waterPrice > 0 && decidedGames.length === 0) {
          throw new Error("No games have a decided winner yet, so the water cost can't be split");
        }

        var courtAndShuttlecockTotal = shuttlecockPrice + courtPrice;
        var totalSlots = games.length * 4;
        var costPerSlot = Math.ceil(courtAndShuttlecockTotal / totalSlots);

        var loserSlots = decidedGames.length * 2;
        var waterPerLoserSlot = loserSlots === 0 ? 0 : Math.ceil(waterPrice / loserSlots);

        return Players.findAll().then(function (allPlayers) {
          var nameById = {};
          allPlayers.forEach(function (p) {
            nameById[p.id] = p.name;
          });

          var byPlayer = {};
          function agg(id) {
            if (!byPlayer[id]) {
              byPlayer[id] = { name: nameById[id], gamesPlayed: 0, gamesLost: 0 };
            }
            return byPlayer[id];
          }

          games.forEach(function (g) {
            [g.team1Player1Id, g.team1Player2Id, g.team2Player1Id, g.team2Player2Id].forEach(function (id) {
              agg(id).gamesPlayed++;
            });
          });
          decidedGames.forEach(function (g) {
            var loserIds = g.winningTeam === 1
              ? [g.team2Player1Id, g.team2Player2Id]
              : [g.team1Player1Id, g.team1Player2Id];
            loserIds.forEach(function (id) {
              agg(id).gamesLost++;
            });
          });

          var shares = Object.keys(byPlayer).map(function (id) {
            var a = byPlayer[id];
            var gameShare = a.gamesPlayed * costPerSlot;
            var lostShare = a.gamesLost * waterPerLoserSlot;
            return {
              name: a.name,
              gamesPlayed: a.gamesPlayed,
              gamesLost: a.gamesLost,
              gameShare: gameShare,
              lostShare: lostShare,
              amount: gameShare + lostShare
            };
          });
          shares.sort(function (x, y) {
            if (y.gamesLost !== x.gamesLost) {
              return y.gamesLost - x.gamesLost;
            }
            return y.amount - x.amount;
          });

          return {
            totalPrice: courtAndShuttlecockTotal + waterPrice,
            gameCount: games.length,
            costPerSlot: costPerSlot,
            waterPerLoserSlot: waterPerLoserSlot,
            players: shares
          };
        });
      });
    }
  };

  global.Players = Players;
  global.GameDays = GameDays;
  global.Games = Games;
  global.Settlement = Settlement;
})(window);
