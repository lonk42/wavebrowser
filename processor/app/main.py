import speech_recognition
from tempfile import TemporaryFile
from pydub import AudioSegment
from os import walk,path
import sqlite3

class Recording_Processor:

	def __init__(self):

		# Initialize
		self.recognizer = speech_recognition.Recognizer()

		# Connect to sqlite db and initalize
		self.db = sqlite3.connect("/recordings/transcriptions.sqlite3")
		self.db.execute('CREATE TABLE IF NOT EXISTS files (id INTEGER PRIMARY KEY, filename TEXT UNIQUE)')
		self.db.execute('CREATE TABLE IF NOT EXISTS providers (id INTEGER PRIMARY KEY, name TEXT UNIQUE)')
		self.db.execute('CREATE TABLE IF NOT EXISTS transcriptions (id INTEGER PRIMARY KEY, file_id INTEGER, provider_id INTEGER, date TEXT, transcription TEXT)')
		self.db.execute('INSERT OR IGNORE INTO providers(name) VALUES("sphinx")')
		self.db.commit()

		# List files in the recordings directory
		for root, dirs, files in walk("/recordings"):

			# Skip if there are no files here
			if len(files) == 0:
				continue

			# Call the transcriber against the file
			for file in files:

				# Only MP3 is supported
				if not file.endswith(".mp3"):
					continue

				self.transcribe(root, file)

	def transcribe(self, root, file):
		file_path = path.join(root,file)

		# We might have seen this file already
		querry = self.db.execute('INSERT OR IGNORE INTO files(filename) VALUES("%s")' % (file))
		self.db.commit()
		querry = self.db.execute('SELECT id FROM files where filename = "%s"' % (file))
		file_id = querry.fetchone()[0]

		# Check for an existing transcription
		querry = self.db.execute('SELECT date from transcriptions where file_id = "%d" AND provider_id = (SELECT id FROM providers WHERE name = "sphinx")' % (file_id))
		if len(querry.fetchall()) > 0:
			print('Existing sphinx transcription found for "%s", skipping...' % (file_path))
			return

		print("Begining transcription on file '%s'" % (file_path))

		# Convert file to a wav
		with TemporaryFile() as temp_file:
			sound = AudioSegment.from_mp3(file_path)
			sound.export(temp_file, format="wav")

			# Crack open this sucker
			with speech_recognition.AudioFile(temp_file) as source:
				audio = self.recognizer.record(source)

			# Run file over sphinx and insert to db
			try:
				transcription = self.recognizer.recognize_sphinx(audio)
				print("Sphinx transcription: '%s'" % (transcription))
			except speech_recognition.UnknownValueError:
				print("Sphinx could not understand audio")
			except speech_recognition.RequestError as e:
				print("Sphinx error; {0}".format(e))
			
			# Insert into the db
			self.db.execute('INSERT INTO transcriptions(file_id, provider_id, date, transcription) VALUES(%d, (SELECT id FROM providers WHERE name = "sphinx"), datetime("now"), "%s")' % (file_id, self.recognizer.recognize_sphinx(audio)))
			self.db.commit()

if __name__ == "__main__":
	Recording_Processor()
	
